param([string]$Mode = 'worker')

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
if ($Mode -ne 'safety-worker') {
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
}

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Text;
using System.Runtime.InteropServices;
public static class NativeWindowProbe {
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr hWndParent, EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    public static IntPtr[] GetTopLevelWindows() {
        var windows = new List<IntPtr>();
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) { windows.Add(hWnd); return true; }, IntPtr.Zero);
        return windows.ToArray();
    }
    public static IntPtr[] GetChildWindows(IntPtr parent) {
        var windows = new List<IntPtr>();
        EnumChildWindows(parent, delegate(IntPtr hWnd, IntPtr lParam) { windows.Add(hWnd); return true; }, IntPtr.Zero);
        return windows.ToArray();
    }
    public static string GetTitle(IntPtr hWnd) {
        int length = GetWindowTextLength(hWnd);
        var buffer = new StringBuilder(Math.Max(1, length + 1));
        GetWindowText(hWnd, buffer, buffer.Capacity);
        return buffer.ToString();
    }
    public static string GetClass(IntPtr hWnd) {
        var buffer = new StringBuilder(512);
        GetClassName(hWnd, buffer, buffer.Capacity);
        return buffer.ToString();
    }
}
"@

function Clean-Text([object]$Value, [int]$Max = 240) {
    if ($null -eq $Value) { return '' }
    $text = ([string]$Value -replace '\s+', ' ').Trim()
    if ($text.Length -gt $Max) { return $text.Substring(0, $Max) }
    return $text
}

function Get-Hash([string]$Text) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$Text)
        return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant()
    } finally { $sha.Dispose() }
}

function Get-Rect($Element) {
    try {
        $r = $Element.Current.BoundingRectangle
        if ($r.Width -le 0 -or $r.Height -le 0) { return $null }
        return [pscustomobject]@{ x=[double]$r.X; y=[double]$r.Y; width=[double]$r.Width; height=[double]$r.Height }
    } catch { return $null }
}

function Get-TypeName($Element) {
    try { return (Clean-Text $Element.Current.ControlType.ProgrammaticName 80).Replace('ControlType.', '') } catch { return 'Unknown' }
}

function Get-ValueFingerprint($Element, [string]$TypeName) {
    if ($TypeName -ne 'Edit' -and $TypeName -ne 'ComboBox') { return $null }
    try {
        $pattern = $null
        if (-not $Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) { return $null }
        $value = [string]$pattern.Current.Value
        return [pscustomobject]@{ length=$value.Length; sha256=(Get-Hash $value).Substring(0, 24) }
    } catch { return $null }
}

function Get-State($Element) {
    $selected = $null; $expanded = $null; $toggle = $null
    try {
        $p = $null
        if ($Element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $selected = [bool]$p.Current.IsSelected }
    } catch {}
    try {
        $p = $null
        if ($Element.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { $expanded = [string]$p.Current.ExpandCollapseState }
    } catch {}
    try {
        $p = $null
        if ($Element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) { $toggle = [string]$p.Current.ToggleState }
    } catch {}
    try {
        return [pscustomobject]@{
            enabled=[bool]$Element.Current.IsEnabled
            offscreen=[bool]$Element.Current.IsOffscreen
            focused=[bool]$Element.Current.HasKeyboardFocus
            selected=$selected
            expanded=$expanded
            toggle=$toggle
        }
    } catch {
        return [pscustomobject]@{ enabled=$false; offscreen=$true; focused=$false; selected=$selected; expanded=$expanded; toggle=$toggle }
    }
}

function Get-Surface([string]$TypeName, [string]$Name) {
    if ($TypeName -eq 'Tab' -or $TypeName -eq 'TabItem') { return 'tabstrip' }
    if ($TypeName -eq 'Edit') { return 'omnibox_or_find' }
    if ($TypeName -eq 'MenuBar' -or $TypeName -eq 'MenuItem') { return 'menu' }
    if ($TypeName -eq 'ToolBar') { return 'toolbar' }
    if ($TypeName -eq 'Button' -or $TypeName -eq 'SplitButton' -or $TypeName -eq 'ComboBox') { return 'toolbar_or_menu' }
    if ($TypeName -eq 'Window') { return 'popup' }
    return 'browser_chrome'
}

function New-ControlSnapshot($Element, [int]$Index) {
    $type = Get-TypeName $Element
    $name = ''
    $automationId = ''
    $className = ''
    try { $name = Clean-Text $Element.Current.Name 240 } catch {}
    try { $automationId = Clean-Text $Element.Current.AutomationId 160 } catch {}
    try { $className = Clean-Text $Element.Current.ClassName 160 } catch {}
    $processId = $null; $nativeWindowHandle = $null
    try { $processId = [int]$Element.Current.ProcessId } catch {}
    try { $nativeWindowHandle = [int64]$Element.Current.NativeWindowHandle } catch {}
    return [pscustomobject]@{
        index=$Index
        surface=(Get-Surface $type $name)
        controlType=$type
        name= $(if ($name) { $name } else { $null })
        automationId= $(if ($automationId) { $automationId } else { $null })
        className= $(if ($className) { $className } else { $null })
        processId=$processId
        nativeWindowHandle=$nativeWindowHandle
        rect=(Get-Rect $Element)
        state=(Get-State $Element)
        valueFingerprint=(Get-ValueFingerprint $Element $type)
    }
}

function Get-ChromeWindows([bool]$NativeOnly = $false) {
    $out = @()
    foreach ($handle in [NativeWindowProbe]::GetTopLevelWindows()) {
        try {
            if (-not [NativeWindowProbe]::IsWindowVisible($handle)) { continue }
            [uint32]$processId = 0
            [void][NativeWindowProbe]::GetWindowThreadProcessId($handle, [ref]$processId)
            if ($processId -le 0) { continue }
            $process = [System.Diagnostics.Process]::GetProcessById([int]$processId)
            if ($process.ProcessName -ne 'chrome') { continue }
            $className = Clean-Text ([NativeWindowProbe]::GetClass($handle)) 160
            if ($className -notlike 'Chrome_WidgetWin_*') { continue }
            $name = Clean-Text ([NativeWindowProbe]::GetTitle($handle)) 300
            $element = $null
            if (-not $NativeOnly) {
                try { $element = [System.Windows.Automation.AutomationElement]::FromHandle($handle) } catch {}
                if (-not $name -and $null -ne $element) { try { $name = Clean-Text $element.Current.Name 300 } catch {} }
            }
            $minimized = [NativeWindowProbe]::IsIconic($handle)
            $rect = if ($minimized) { $null } else { Get-NativeRect $handle }
            $out += [pscustomobject]@{
                handle=[int64]$handle.ToInt64()
                element=$element
                processId=[int]$processId
                name=$(if ($name) { $name } else { $null })
                className=$className
                rect=$rect
                minimized=[bool]$minimized
            }
        } catch {}
    }
    return @($out)
}

function Window-Score($Window, [string]$ExpectedTitle) {
    $expected = Clean-Text $ExpectedTitle 240
    $name = Clean-Text $Window.name 300
    if (-not $expected) { return 0 }
    if ([string]::Equals($name, $expected, [System.StringComparison]::OrdinalIgnoreCase)) { return 130 }
    if ($name.StartsWith($expected, [System.StringComparison]::OrdinalIgnoreCase)) { return 120 }
    if ($name.IndexOf($expected, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { return 110 }
    return 0
}

function Select-ChromeWindow([string]$ExpectedTitle, [bool]$NativeOnly = $false) {
    $windows = @(Get-ChromeWindows $NativeOnly)
    if ($windows.Count -eq 0) { return [pscustomobject]@{ element=$null; confidence='none'; reason='chrome_window_not_found'; candidates=0 } }
    if ($windows.Count -eq 1) {
        $score = Window-Score $windows[0] $ExpectedTitle
        if ($score -gt 0) { return [pscustomobject]@{ element=$windows[0]; confidence='title_match'; reason=$null; candidates=1 } }
        if (-not (Clean-Text $ExpectedTitle 240)) { return [pscustomobject]@{ element=$windows[0]; confidence='single_window'; reason=$null; candidates=1 } }
        return [pscustomobject]@{ element=$null; confidence='none'; reason='chrome_window_title_mismatch'; candidates=1 }
    }
    $ranked = @($windows | ForEach-Object { [pscustomobject]@{ row=$_; score=(Window-Score $_ $ExpectedTitle) } } | Sort-Object score -Descending)
    if ($ranked.Count -gt 0 -and $ranked[0].score -gt 0) {
        $best = $ranked[0].score
        $ties = @($ranked | Where-Object { $_.score -eq $best })
        if ($ties.Count -eq 1) { return [pscustomobject]@{ element=$ranked[0].row; confidence='title_match'; reason=$null; candidates=$windows.Count } }
    }
    return [pscustomobject]@{ element=$null; confidence='none'; reason='ambiguous_chrome_window'; candidates=$windows.Count }
}

function Get-BrowserControls($WindowElement, $NativeWindowRect = $null) {
    if ($null -eq $WindowElement) { return @() }
    $allowed = @('Tab','TabItem','ToolBar','Button','Edit','MenuBar','MenuItem','ComboBox','SplitButton','Window')
    $windowRect = if ($null -ne $NativeWindowRect) { $NativeWindowRect } else { Get-Rect $WindowElement }
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue([pscustomobject]@{ element=$WindowElement; depth=0 })
    $controls = @(); $index = 0
    while ($queue.Count -gt 0 -and $controls.Count -lt 220) {
        $item = $queue.Dequeue(); $element = $item.element; $depth = [int]$item.depth
        if ($depth -ge 9) { continue }
        $children = $null
        try { $children = $element.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) } catch { continue }
        for ($i=0; $i -lt $children.Count -and $controls.Count -lt 220; $i++) {
            $child = $children.Item($i)
            $type = Get-TypeName $child
            $className = ''
            try { $className = [string]$child.Current.ClassName } catch {}
            # Never walk into rendered web content. This observer is browser-chrome only.
            if ($type -eq 'Document' -or $className -eq 'Chrome_RenderWidgetHostHWND') { continue }
            $rect = Get-Rect $child
            # Defense in depth: a large pane below the title bar is web/content chrome, not browser controls.
            if ($type -eq 'Pane' -and $null -ne $rect -and $null -ne $windowRect -and $rect.Y -gt ($windowRect.Y + 50) -and $rect.Height -gt ($windowRect.Height * 0.60) -and $rect.Width -gt ($windowRect.Width * 0.50)) { continue }
            $offscreen = $true
            try { $offscreen = [bool]$child.Current.IsOffscreen } catch {}
            if ($allowed -contains $type -and $null -ne $rect -and -not $offscreen) {
                $index++; $controls += (New-ControlSnapshot $child $index)
            }
            $queue.Enqueue([pscustomobject]@{ element=$child; depth=($depth+1) })
        }
    }
    return @($controls)
}

function Get-IntersectionRect($A, $B) {
    if ($null -eq $A -or $null -eq $B) { return $null }
    $left = [Math]::Max([double]$A.x, [double]$B.x)
    $top = [Math]::Max([double]$A.y, [double]$B.y)
    $right = [Math]::Min([double]$A.x + [double]$A.width, [double]$B.x + [double]$B.width)
    $bottom = [Math]::Min([double]$A.y + [double]$A.height, [double]$B.y + [double]$B.height)
    if ($right -le $left -or $bottom -le $top) { return $null }
    return [pscustomobject]@{ x=$left; y=$top; width=($right-$left); height=($bottom-$top) }
}

function Select-AddressBarControl($Controls) {
    $edits = @($Controls | Where-Object { $_.controlType -eq 'Edit' -and $null -ne $_.rect })
    if ($edits.Count -eq 0) { return $null }

    # Prefer Chromium's UIA class identity when it is uniquely present.
    # This is language-independent and does not inspect the localized control name.
    $classMatches = @($edits | Where-Object { $_.className -eq 'OmniboxViewViews' })
    if ($classMatches.Count -eq 1) { return $classMatches[0] }

    # Structural fallback: the omnibox is an Edit geometrically contained by
    # the browser toolbar. Avoid localized labels and locale-specific text.
    $toolbars = @($Controls | Where-Object { $_.controlType -eq 'ToolBar' -and $null -ne $_.rect })
    $structural = @()
    foreach ($edit in $edits) {
        foreach ($toolbar in $toolbars) {
            $overlap = Get-IntersectionRect $edit.rect $toolbar.rect
            if ($null -eq $overlap) { continue }
            $editArea = [double]$edit.rect.width * [double]$edit.rect.height
            $overlapArea = [double]$overlap.width * [double]$overlap.height
            if ($editArea -gt 0 -and ($overlapArea / $editArea) -ge 0.90) {
                $structural += $edit
                break
            }
        }
    }
    if ($structural.Count -eq 1) { return $structural[0] }
    if ($structural.Count -gt 1) {
        return $structural | Sort-Object @{ Expression={ [double]$_.rect.width }; Descending=$true }, @{ Expression={ [double]$_.rect.y }; Ascending=$true } | Select-Object -First 1
    }
    return $null
}

function Get-NativeRect([IntPtr]$Handle) {
    if ($Handle -eq [IntPtr]::Zero -or [NativeWindowProbe]::IsIconic($Handle)) { return $null }
    $r = New-Object NativeWindowProbe+RECT
    if (-not [NativeWindowProbe]::GetWindowRect($Handle, [ref]$r)) { return $null }
    $width = [double]($r.Right-$r.Left); $height = [double]($r.Bottom-$r.Top)
    if ($width -le 0 -or $height -le 0) { return $null }
    return [pscustomobject]@{ x=[double]$r.Left; y=[double]$r.Top; width=$width; height=$height }
}

function Get-NativeWindowSnapshot([IntPtr]$Handle, [int]$ZOrder = 0, [bool]$NativeOnly = $false) {
    if ($Handle -eq [IntPtr]::Zero) { return $null }
    [uint32]$processId = 0
    [void][NativeWindowProbe]::GetWindowThreadProcessId($Handle, [ref]$processId)
    $processName = $null
    try { if ($processId -gt 0) { $processName = [System.Diagnostics.Process]::GetProcessById([int]$processId).ProcessName } } catch {}
    $name = Clean-Text ([NativeWindowProbe]::GetTitle($Handle)) 300
    $className = Clean-Text ([NativeWindowProbe]::GetClass($Handle)) 160
    $controlType = $null
    if (-not $NativeOnly) {
        try {
            $element = [System.Windows.Automation.AutomationElement]::FromHandle($Handle)
            if ($null -ne $element) {
                if (-not $name) { try { $name = Clean-Text $element.Current.Name 300 } catch {} }
                if (-not $className) { try { $className = Clean-Text $element.Current.ClassName 160 } catch {} }
                try { $controlType = Get-TypeName $element } catch {}
            }
        } catch {}
    }
    return [pscustomobject]@{
        handle=[int64]$Handle.ToInt64()
        processId=[int]$processId
        processName=$(if ($processName) { [string]$processName } else { $null })
        name=$(if ($name) { $name } else { $null })
        className=$(if ($className) { $className } else { $null })
        controlType=$(if ($controlType) { $controlType } else { $null })
        rect=(Get-NativeRect $Handle)
        minimized=[bool][NativeWindowProbe]::IsIconic($Handle)
        zOrder=$ZOrder
    }
}

function Get-ContentRect($WindowElement) {
    if ($null -eq $WindowElement) { return $null }
    try {
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Document
        )
        $doc = $WindowElement.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        if ($null -ne $doc) { return Get-Rect $doc }
    } catch {}
    return $null
}

function Get-Win32ContentRect($WindowRow) {
    if ($null -eq $WindowRow -or $null -eq $WindowRow.handle -or $null -eq $WindowRow.rect) { return $null }
    $parent = [IntPtr]([int64]$WindowRow.handle)
    if ($parent -eq [IntPtr]::Zero) { return $null }
    $best = $null; $bestArea = 0.0
    foreach ($handle in [NativeWindowProbe]::GetChildWindows($parent)) {
        try {
            if (-not [NativeWindowProbe]::IsWindowVisible($handle)) { continue }
            $className = Clean-Text ([NativeWindowProbe]::GetClass($handle)) 160
            if ($className -ne 'Chrome_RenderWidgetHostHWND') { continue }
            $rect = Get-NativeRect $handle
            if ($null -eq $rect) { continue }
            $inside = Get-IntersectionRect $rect $WindowRow.rect
            if ($null -eq $inside) { continue }
            $area = [double]$inside.width * [double]$inside.height
            if ($area -gt $bestArea) { $bestArea = $area; $best = $inside }
        } catch {}
    }
    return $best
}

function Rect-Signature($Rect) {
    if ($null -eq $Rect) { return 'null' }
    try { return ('{0},{1},{2},{3}' -f $Rect.x,$Rect.y,$Rect.width,$Rect.height) } catch { return 'null' }
}

function Fact-Text($Value) {
    if ($null -eq $Value) { return '' }
    return [string]$Value
}

function Get-NativeFacts($WindowRow, [bool]$NativeOnly = $false) {
    $targetHandle = [IntPtr]::Zero
    try { if ($null -ne $WindowRow.handle) { $targetHandle = [IntPtr]([int64]$WindowRow.handle) } } catch {}
    if ($targetHandle -eq [IntPtr]::Zero -and $null -ne $WindowRow.element) {
        try { $targetHandle = [IntPtr]([int64]$WindowRow.element.Current.NativeWindowHandle) } catch {}
    }

    $contentRect = Get-Win32ContentRect $WindowRow
    $contentRectSource = if ($null -ne $contentRect) { 'win32_render_widget' } else { $null }
    if ($null -eq $contentRect -and -not $NativeOnly) {
        $contentRect = Get-ContentRect $WindowRow.element
        if ($null -ne $contentRect) { $contentRectSource = 'uia_document' }
    }

    $foregroundHandle = [NativeWindowProbe]::GetForegroundWindow()
    $foreground = Get-NativeWindowSnapshot $foregroundHandle 0 $NativeOnly
    $focused = $null
    if (-not $NativeOnly) {
        try {
            $element = [System.Windows.Automation.AutomationElement]::FocusedElement
            if ($null -ne $element) { $focused = New-ControlSnapshot $element 0 }
        } catch {}
    }

    $occluders = @()
    if ($targetHandle -ne [IntPtr]::Zero -and $null -ne $WindowRow.rect) {
        $cursor = [NativeWindowProbe]::GetWindow($targetHandle, 3)
        $z = 0
        while ($cursor -ne [IntPtr]::Zero -and $z -lt 40 -and $occluders.Count -lt 20) {
            $z++
            if ([NativeWindowProbe]::IsWindowVisible($cursor) -and -not [NativeWindowProbe]::IsIconic($cursor)) {
                $row = Get-NativeWindowSnapshot $cursor $z $NativeOnly
                if ($null -ne $row -and $null -ne $row.rect) {
                    $windowOverlap = Get-IntersectionRect $row.rect $WindowRow.rect
                    $contentOverlap = Get-IntersectionRect $row.rect $contentRect
                    if ($null -ne $windowOverlap) {
                        $occluders += [pscustomobject]@{
                            handle=$row.handle; processId=$row.processId; processName=$row.processName; name=$row.name; className=$row.className; controlType=$row.controlType
                            rect=$row.rect; minimized=$row.minimized; zOrder=$row.zOrder; windowIntersection=$windowOverlap; contentIntersection=$contentOverlap
                        }
                    }
                }
            }
            $cursor = [NativeWindowProbe]::GetWindow($cursor, 3)
        }
    }

    $targetForeground = $null
    if ($targetHandle -ne [IntPtr]::Zero -and $foregroundHandle -ne [IntPtr]::Zero) {
        $targetForeground = [bool]($foregroundHandle -eq $targetHandle)
    }
    $targetMinimized = $null
    if ($targetHandle -ne [IntPtr]::Zero) { $targetMinimized = [bool][NativeWindowProbe]::IsIconic($targetHandle) }

    return [pscustomobject]@{
        targetWindowHandle=$(if ($targetHandle -ne [IntPtr]::Zero) { [int64]$targetHandle.ToInt64() } else { $null })
        targetWindowForeground=$targetForeground
        targetWindowMinimized=$targetMinimized
        windowSource='win32'
        uiAutomationAvailable=$(if ($NativeOnly) { $null } else { [bool]($null -ne $WindowRow.element) })
        contentRect=$contentRect
        contentRectSource=$contentRectSource
        foregroundWindow=$foreground
        focusedElement=$focused
        topLevelOccluders=$occluders
    }
}

function Observe-NativeClickFacts([string]$ExpectedTitle, $RequestedWindowId) {
    $selected = Select-ChromeWindow $ExpectedTitle $true
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($null -eq $selected.element) {
        return [pscustomobject]@{
            available=$true; observed=$false; reason=$selected.reason; confidence=$selected.confidence; observedAt=$now
            source='win32_click_guard'; window=$null; native=$null
        }
    }
    $w = $selected.element
    $native = Get-NativeFacts $w $true
    return [pscustomobject]@{
        available=$true; observed=$true; reason=$null; confidence=$selected.confidence; observedAt=$now
        source='win32_click_guard'
        window=[pscustomobject]@{
            handle=$w.handle; processId=$w.processId; name=$w.name; className=$w.className
            rect=$w.rect; minimized=$w.minimized; requestedWindowId=$RequestedWindowId
        }
        native=$native
    }
}

function Observe-BrowserUi([string]$ExpectedTitle, $RequestedWindowId) {
    $selected = Select-ChromeWindow $ExpectedTitle
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($null -eq $selected.element) {
        return [pscustomobject]@{ available=$true; observed=$false; reason=$selected.reason; confidence=$selected.confidence; observedAt=$now; window=$null; controls=@(); tabs=@(); addressBar=$null; focusedControl=$null; signature=$null }
    }
    $w = $selected.element
    $controls = @(Get-BrowserControls $w.element $w.rect)
    $tabs = @($controls | Where-Object { $_.controlType -eq 'TabItem' })
    $addressBar = Select-AddressBarControl $controls
    $native = Get-NativeFacts $w
    $focused = $native.focusedElement
    if ($null -eq $focused) { $focused = $controls | Where-Object { $_.state.focused -eq $true } | Select-Object -First 1 }
    $sigRows = @($controls | ForEach-Object { $vf = if ($null -ne $_.valueFingerprint) { $_.valueFingerprint.sha256 } else { '' }; '{0}|{1}|{2}|{3}|{4}|{5}|{6}' -f $_.controlType,$_.name,$_.state.focused,$_.state.selected,$_.state.expanded,$_.state.toggle,$vf })
    $focusPid = ''; $focusType = ''
    if ($null -ne $native.focusedElement) {
        $focusPid = Fact-Text $native.focusedElement.processId
        $focusType = Fact-Text $native.focusedElement.controlType
    }
    $contentSig = Rect-Signature $native.contentRect
    $nativeSig = @(
        "foreground=$(Fact-Text $native.targetWindowForeground)",
        "minimized=$(Fact-Text $native.targetWindowMinimized)",
        "focusPid=$focusPid",
        "focusType=$focusType",
        "contentSource=$(Fact-Text $native.contentRectSource)",
        "content=$contentSig"
    )
    $nativeSig += @($native.topLevelOccluders | ForEach-Object { $r = Rect-Signature $_.rect; "occ=$($_.handle):$r" })
    $signature = (Get-Hash (($sigRows + $nativeSig) -join "`n")).Substring(0, 32)
    return [pscustomobject]@{
        available=$true; observed=$true; reason=$null; confidence=$selected.confidence; observedAt=$now
        window=[pscustomobject]@{ handle=$w.handle; processId=$w.processId; name=$w.name; className=$w.className; rect=$w.rect; minimized=$w.minimized; requestedWindowId=$RequestedWindowId }
        native=$native
        controls=$controls; tabs=$tabs; addressBar=$addressBar; focusedControl=$focused; signature=$signature
    }
}

function Write-Reply($Reply) {
    [Console]::Out.WriteLine(($Reply | ConvertTo-Json -Depth 9 -Compress))
    [Console]::Out.Flush()
}

if ($Mode -ne 'worker' -and $Mode -ne 'safety-worker') { throw 'windows_ui_observer supports worker or safety-worker mode only' }
while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $id = $null
    try {
        $msg = $line | ConvertFrom-Json
        $id = [string]$msg.id
        if ($Mode -eq 'safety-worker') {
            $snapshot = Observe-NativeClickFacts ([string]$msg.title) $msg.windowId
        } else {
            $snapshot = Observe-BrowserUi ([string]$msg.title) $msg.windowId
        }
        Write-Reply ([pscustomobject]@{ id=$id; ok=$true; snapshot=$snapshot })
    } catch {
        Write-Reply ([pscustomobject]@{ id=$id; ok=$false; error=(Clean-Text $_.Exception.Message 180) })
    }
}
