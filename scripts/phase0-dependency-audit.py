from pathlib import Path
import json,re,hashlib,subprocess
src=Path('/Users/sabeqmmursyid/_contentflow-staging');dst=Path('/Users/sabeqmmursyid/_cfstudio')
seeds=['lib/re-multiplier-worker.js','lib/scheduler-processors.js','lib/webhook-client.js','lib/video-studio-processor.js','lib/recipe-planner-engine.js','lib/recipe-production-adapter.js','lib/content-planner-engine.js','lib/visual-identity-repository.js','lib/visual-identity-system-presets.js','lib/operator-presets.js','lib/universe-presets.js','lib/start-frame-worker.js','lib/pillar-start-frame-service.js','lib/pillar-stage-execution-service.js','lib/auth.js','lib/tenant-admin.js','lib/repliz-client.js','lib/content-automation-worker.js','lib/content-automation-notification-worker.js','instrumentation.js','scripts/glabs-worker.js']
regexes=[re.compile(r'''^\s*(?:import|export)\s+(?:[^;]*?\s+from\s+)?['"]([^'"\n]+)['"]''',re.M),re.compile(r'''\bimport\(\s*['"]([^'"\n]+)['"]\s*\)''')]
seen=set();pending=list(seeds);files=[];externals=set();missing=[]
while pending:
 rel=pending.pop()
 if rel in seen:continue
 seen.add(rel);p=src/rel
 if not p.is_file():missing.append(rel);continue
 b=p.read_bytes();s=b.decode(errors='replace');imports=sorted(set(x for pattern in regexes for x in pattern.findall(s)))
 edges=[]
 for imp in imports:
  if imp.startswith('.') or imp.startswith('@/'):
   base=(src/imp[2:]) if imp.startswith('@/') else (p.parent/imp)
   candidates=[base,Path(str(base)+'.js'),Path(str(base)+'.mjs'),base/'index.js']
   hit=next((x.resolve() for x in candidates if x.is_file()),None)
   if hit and hit.is_relative_to(src):
    resolved=str(hit.relative_to(src));edges.append(resolved)
    if hit.suffix in ['.js','.mjs','.cjs']:pending.append(resolved)
   else:missing.append(rel+' -> '+imp)
  else:externals.add(imp)
 risks=[]
 for word,label in [('getDb(','database coupling'),('process.env','runtime environment'),('setInterval(','background timer'),('execSync(','subprocess execution'),('generateImage(','image provider'),('generateVideo(','video provider')]:
  if word in s:risks.append(label)
 files.append({'path':rel,'sha256':hashlib.sha256(b).hexdigest(),'dependencies':edges,'risks':risks,'adoption':'audit-only; not copied/activated'})
report={'sourceRoot':str(src),'localSourceSha':subprocess.check_output(['git','-C',str(src),'rev-parse','HEAD'],text=True).strip(),'sourceReadOnly':True,'seedFiles':seeds,'moduleCount':len(files),'files':sorted(files,key=lambda x:x['path']),'externalImports':sorted(externals),'unresolved':sorted(set(missing)),'notes':['Static literal imports only; dynamic computed imports require manual audit.','Shared helpers need tenant-aware repository adapters, not wholesale scheduler copy.']}
(dst/'docs/adoption-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'moduleCount':len(files),'externalImportCount':len(externals),'unresolvedCount':len(set(missing))}))
