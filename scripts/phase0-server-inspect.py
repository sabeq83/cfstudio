import subprocess, json, shlex
from pathlib import Path
paths=json.loads(Path('/tmp/cf-phase0-local-media.json').read_text())
code='''import json,sys,os,subprocess,shutil
from pathlib import Path
paths=json.load(sys.stdin)
root=Path.home()/"maknaflow-staging-atomic/current"
fallback=Path.home()/"maknaflow-staging"
active=root.resolve() if root.exists() else fallback.resolve()
public=active/"public"
report={"activeRoot":str(active),"atomicCurrentExists":root.exists(),"sourceGitSha":None,"media":{"requested":len(paths),"found":0,"missing":0,"outsideScope":0,"totalBytes":0,"missingPathHashes":[]},"processes":[]}
try:report["sourceGitSha"]=subprocess.check_output(["git","-C",str(active),"rev-parse","HEAD"],text=True,stderr=subprocess.DEVNULL).strip()
except:pass
import hashlib
missing_paths=[]
for raw in paths:
 p=Path(raw)
 if raw.startswith("/uploads/") or raw.startswith("/temp/"):p=public/raw.lstrip("/")
 elif raw.startswith("public/"):p=active/raw
 elif raw.startswith("uploads/"):p=public/raw
 elif not p.is_absolute():report["media"]["outsideScope"]+=1;continue
 resolved=p.resolve()
 roots=[public.resolve(),(Path.home()/"maknaflow-staging-atomic/shared").resolve(),(fallback/"public").resolve(),(fallback/"data").resolve(),(Path.home()/"maknaflow-staging-atomic").resolve()]
 if not any(resolved.is_relative_to(r) for r in roots):report["media"]["outsideScope"]+=1;continue
 if p.is_file():report["media"]["found"]+=1;report["media"]["totalBytes"]+=p.stat().st_size
 else:missing_paths.append(p);report["media"]["missing"]+=1;report["media"]["missingPathHashes"].append(hashlib.sha256(raw.encode()).hexdigest())
recovered=set();recoverable=0
for p in missing_paths:
 for folder in [active/"data/temp",Path.home()/"maknaflow-staging-atomic/shared/data/temp",fallback/"data/temp"]:
  candidate=folder/p.name
  if candidate.is_file():recoverable+=1;recovered.add(candidate.resolve());break
report["media"]["recoverableAtKnownCurrentLocations"]=recoverable
report["media"]["uniqueRecoveredFiles"]=len(recovered)
report["media"]["recoveredBytes"]=sum(p.stat().st_size for p in recovered)
import urllib.request
report["health"]={}
for label,url in [("ui","http://127.0.0.1:5010"),("api","http://127.0.0.1:7010/health")]:
 try:
  response=urllib.request.urlopen(url,timeout=5);report["health"][label]=response.status
 except Exception:report["health"][label]="unavailable"
pm2=shutil.which("pm2")
if not pm2:
 for candidate in ["/opt/homebrew/bin/pm2","/usr/local/bin/pm2"]:
  if Path(candidate).exists():pm2=candidate;break
if pm2:
 try:
  env=dict(os.environ);env["PATH"]="/opt/homebrew/bin:/usr/local/bin:"+env.get("PATH","")
  result=subprocess.run([pm2,"jlist"],capture_output=True,text=True,env=env,timeout=15)
  data=json.loads(result.stdout)
  report["processes"]=[{"name":p.get("name"),"status":p.get("pm2_env",{}).get("status"),"cwd":p.get("pm2_env",{}).get("pm_cwd")} for p in data if "staging" in p.get("name","")]
 except Exception:report["processInspection"]="unavailable"
else:report["processInspection"]="pm2_not_found"
print(json.dumps(report))
'''
res=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=8','masbenu@100.95.245.55','python3 -c '+shlex.quote(code)],input=json.dumps(paths),capture_output=True,text=True,timeout=55)
if res.returncode==0:
 report=json.loads(res.stdout);Path('/tmp/cf-phase0-server.json').write_text(json.dumps(report,indent=2));summary=dict(report);summary["media"]=dict(report["media"]);summary["media"].pop("missingPathHashes",None);print(json.dumps(summary))
else:
 report={'status':'unavailable','sshExitCode':res.returncode,'mediaVerified':False};Path('/tmp/cf-phase0-server.json').write_text(json.dumps(report));print(json.dumps(report))
