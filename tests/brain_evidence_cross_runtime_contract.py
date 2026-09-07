from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from brain.data_factory import DataFactory
from brain.store import BrainStore


NODE_SCRIPT = r"""
const path=require('node:path');
const {EvidenceStore}=require('./daemon/src/evidence_store');
const root=process.argv[1];
const store=new EvidenceStore(root,{now:()=>1788775200000,randomBytes:size=>Buffer.alloc(size,7)});
store.append({
  identity:{companyId:'COMPANY-A',deviceId:'DEVICE-A',browserInstanceId:'browser-a',extensionInstanceId:'extension-a',runtimeExtensionId:'runtime-a'},
  siteKey:'youtube.com',tabId:7,source:'human',
  provenance:{kind:'human_demonstration',trustedInput:true,triggerEventTs:1788775199000,semanticObserver:'youtube-v1'},
  beforeState:{available:true,platform:'youtube',observerVersion:1,observedAt:1788775198000,privacy:{searchQueryCaptured:false,accountIdentityCaptured:false,textContentCaptured:false},route:{supported:true,pageType:'home',searchQueryPresent:false},controls:{searchInput:{name:'search_input',available:true,visible:true,active:true,tag:'input',actionRect:{x:100.5,y:40,width:400,height:36}},searchButton:{name:'search_button',available:true,visible:true,active:false,tag:'button',actionRect:{x:500,y:40,width:40,height:36}}},surfaces:[],viewport:{width:1280,height:720}},
  action:{type:'youtube.search',trigger:'keyboard_enter',queryCaptured:false},
  afterState:{available:true,platform:'youtube',observerVersion:1,observedAt:1788775200000,privacy:{searchQueryCaptured:false,accountIdentityCaptured:false,textContentCaptured:false},route:{supported:true,pageType:'search',searchQueryPresent:true},controls:{searchInput:{name:'search_input',available:true,visible:true,active:true,tag:'input',actionRect:{x:100.5,y:40,width:400,height:36}},searchButton:{name:'search_button',available:true,visible:true,active:false,tag:'button',actionRect:{x:500,y:40,width:40,height:36}}},surfaces:[{surface:'search_results',itemCount:12}],viewport:{width:1280,height:720}},
  observedEffect:{navigationObserved:true,pageTypeChanged:true,fromPageType:'home',toPageType:'search',searchResultsObserved:true,searchResultCount:12,searchResultCountChanged:false}
});
"""


class BrainEvidenceCrossRuntimeContractTest(unittest.TestCase):
    def test_python_data_factory_accepts_node_evidence_store_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            evidence_root = root / "evidence"
            result = subprocess.run(
                ["node", "-e", NODE_SCRIPT, str(evidence_root)],
                cwd=str(ROOT),
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, msg=f"node evidence fixture failed: {result.stderr}")
            with BrainStore(root / "brain.db") as store:
                compiled = DataFactory(store).ingest_directory(evidence_root)
                self.assertEqual(compiled["files"], 1)
                self.assertEqual(compiled["stored"], 1)
                records = store.list_records(capability="youtube.search", platform="youtube")
                self.assertEqual(len(records), 1)
                self.assertEqual(records[0]["provenance"]["source"], "human")
                self.assertEqual(records[0]["semantic"]["effect"]["pageType"], "search")


if __name__ == "__main__":
    unittest.main()
