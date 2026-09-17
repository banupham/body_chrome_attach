param([string]$Mode = 'worker')

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

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
    return [pscustomobject]@{
        index=$Index
        surface=(Get-Surface $type $name)
        controlType=$type
        name= $(if ($name) { $name } else { $null })
        automationId= $(if ($automationId) { $automationId } else { $null })
        className= $(if ($className) { $className } else { $null })
        rect=(Get-Rect $Element)
        state=(Get-State $Element)
        valueFingerprint=(Get-ValueFingerprint $Element $type)
    }
}

function Get-ChromeWindows {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $children = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
    $out = @()
    for ($i=0; $i -lt $children.Count; $i++) {
        $e = $children.Item($i)
        try {
            $className = [string]$e.Current.ClassName
            if ($className -notlike 'Chrome_WidgetWin_*') { continue }
            if ($e.Current.IsOffscreen) { continue }
            $rect = Get-Rect $e
            if ($null -eq $rect) { continue }
            $pid = [int]$e.Current.ProcessId
            $process = [System.Diagnostics.Process]::GetProcessById($pid)
            if ($process.ProcessName -ne 'chrome') { continue }
            $out += [pscustomobject]@{ element=$e; processId=$pid; name=(Clean-Text $e.Current.Name 300); className=$className; rect=$rect }
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

function Select-ChromeWindow([string]$ExpectedTitle) {
    $windows = @(Get-ChromeWindows)
    if ($windows.Count -eq 0) { return [pscustomobject]@{ element=$null; confidence='none'; reason='chrome_window_not_found'; candidates=0 } }
    if ($windows.Count -eq 1) { return [pscustomobject]@{ element=$windows[0]; confidence=$(if ((Window-Score $windows[0] $ExpectedTitle) -gt 0) {'title_match'} else {'single_window'}); reason=$null; candidates=1 } }
    $ranked = @($windows | ForEach-Object { [pscustomobject]@{ row=$_; score=(Window-Score $_ $ExpectedTitle) } } | Sort-Object score -Descending)
    if ($ranked.Count -gt 0 -and $ranked[0].score -gt 0) {
        $best = $ranked[0].score
        $ties = @($ranked | Where-Object { $_.score -eq $best })
        if ($ties.Count -eq 1) { return [pscustomobject]@{ element=$ranked[0].row; confidence='title_match'; reason=$null; candidates=$windows.Count } }
    }
    return [pscustomobject]@{ element=$null; confidence='none'; reason='ambiguous_chrome_window'; candidates=$windows.Count }
}

function Get-BrowserControls($WindowElement) {
    $allowed = @('Tab','TabItem','ToolBar','Button','Edit','MenuBar','MenuItem','ComboBox','SplitButton','Window')
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

function Observe-BrowserUi([string]$ExpectedTitle, $RequestedWindowId) {
    $selected = Select-ChromeWindow $ExpectedTitle
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    if ($null -eq $selected.element) {
        return [pscustomobject]@{ available=$true; observed=$false; reason=$selected.reason; confidence=$selected.confidence; observedAt=$now; window=$null; controls=@(); tabs=@(); addressBar=$null; focusedControl=$null; signature=$null }
    }
    $w = $selected.element
    $controls = @(Get-BrowserControls $w.element)
    $tabs = @($controls | Where-Object { $_.controlType -eq 'TabItem' })
    $addressBar = $controls | Where-Object { $_.controlType -eq 'Edit' -and ($_.name -match '(?i)address|search|omnibox|địa chỉ|tìm kiếm') } | Select-Object -First 1
    $focused = $controls | Where-Object { $_.state.focused -eq $true } | Select-Object -First 1
    $sigRows = @($controls | ForEach-Object { $vf = if ($null -ne $_.valueFingerprint) { $_.valueFingerprint.sha256 } else { '' }; '{0}|{1}|{2}|{3}|{4}|{5}|{6}' -f $_.controlType,$_.name,$_.state.focused,$_.state.selected,$_.state.expanded,$_.state.toggle,$vf })
    $signature = (Get-Hash ($sigRows -join "`n")).Substring(0, 32)
    return [pscustomobject]@{
        available=$true; observed=$true; reason=$null; confidence=$selected.confidence; observedAt=$now
        window=[pscustomobject]@{ processId=$w.processId; name=$w.name; className=$w.className; rect=$w.rect; requestedWindowId=$RequestedWindowId }
        controls=$controls; tabs=$tabs; addressBar=$addressBar; focusedControl=$focused; signature=$signature
    }
}

function Write-Reply($Reply) {
    [Console]::Out.WriteLine(($Reply | ConvertTo-Json -Depth 9 -Compress))
    [Console]::Out.Flush()
}

if ($Mode -ne 'worker') { throw 'windows_ui_observer supports worker mode only' }
while ($null -ne ($line = [Console]::In.ReadLine())) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $id = $null
    try {
        $msg = $line | ConvertFrom-Json
        $id = [string]$msg.id
        $snapshot = Observe-BrowserUi ([string]$msg.title) $msg.windowId
        Write-Reply ([pscustomobject]@{ id=$id; ok=$true; snapshot=$snapshot })
    } catch {
        Write-Reply ([pscustomobject]@{ id=$id; ok=$false; error=(Clean-Text $_.Exception.Message 180) })
    }
}
