#!/usr/bin/env python3
"""Measure a temporary AppKit build without opening the user's CourseWatch data.
Run after build:web/build:server. Requests one macOS administrator authorization
for powermetrics only when --with-power is selected. Process attribution is read-only and unprivileged. No sudoers/account/
application permissions are changed. Raw system process data stays in .cache.
"""
import ctypes, datetime, json, os, pathlib, plistlib, shlex, statistics, subprocess, sys, time
from zoneinfo import ZoneInfo

RUN_DATE = datetime.datetime.now(ZoneInfo('Asia/Shanghai')).date().isoformat()
ROOT = pathlib.Path(__file__).resolve().parent.parent
os.chdir(ROOT)
CACHE = ROOT / '.cache' / 'macos-performance'
CACHE.mkdir(parents=True, exist_ok=True)
WITH_POWER = '--with-power' in sys.argv
SECONDS = int(os.environ.get('COURSEWATCH_MEASURE_SECONDS', '120'))
if not 30 <= SECONDS <= 600:
    raise SystemExit('Sample duration must be 30–600 seconds per state')
APP = CACHE / 'CourseWatch Performance.app'
RES = APP / 'Contents/Resources'
(RES / 'app').mkdir(parents=True, exist_ok=True)
(APP / 'Contents/MacOS').mkdir(parents=True, exist_ok=True)
DATA = CACHE / 'data'
if DATA.exists():
    raise SystemExit('Move the previous .cache/macos-performance directory before a fresh run')
DATA.mkdir()
CONTROL, STATUS = CACHE / 'control.txt', CACHE / 'status.json'
entry = CACHE / 'service.mjs'
entry.write_text(f'''import {{createServer}} from {json.dumps(str(ROOT / 'dist/server/apps/local-service/src/server.js'))};
const s=await createServer({{dir:process.env.COURSEWATCH_DATA_DIR,port:17401}});
s.store.set('monitoring',false);
for(let i=0;i<100;i++)s.engine.saveSchedule({{id:'benchmark-'+i,title:'模拟日程 '+(i+1),note:'仅用于本机资源测量',dueAt:Date.now()+(48+i)*3600000,important:i%10===0,reminderHours:[],done:false,version:1,updatedAt:Date.now()}});
await s.app.listen({{host:'127.0.0.1',port:17401}});
process.on('SIGTERM',async()=>{{await s.app.close();process.exit(0)}});
''')
source = (ROOT / 'apps/macos/main.swift').read_text().replace('17321', '17401')
source = source.replace('FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("CourseWatch")', f'URL(fileURLWithPath: {json.dumps(str(DATA))})')
source = source.replace('child.arguments = ["dist/server/apps/local-service/src/main.js"]', f'child.arguments = [{json.dumps(str(entry))}]')
source = source.replace('        startBackend()\n', '        startBackend()\n        startBenchmarkController()\n', 1)
methods = '''    private func startBenchmarkController() {
        var last = ""
        Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            guard let self = self else { return }
            let command = (try? String(contentsOfFile: CONTROL_PATH, encoding: .utf8)) ?? ""
            if command != last {
                last = command
                switch command {
                case "foreground": self.showWindow()
                case "minimized": self.window?.miniaturize(nil)
                case "closed": self.window?.close()
                case "quit": self.quit()
                default: break
                }
            }
            let status: [String: Any] = ["ready":self.ready,"renderer":self.webView != nil,"active":NSApp.isActive,"visible":self.window?.isVisible ?? false,"minimized":self.window?.isMiniaturized ?? false]
            if let data = try? JSONSerialization.data(withJSONObject:status) { try? data.write(to:URL(fileURLWithPath:STATUS_PATH), options:.atomic) }
        }
    }
'''.replace('CONTROL_PATH',json.dumps(str(CONTROL))).replace('STATUS_PATH',json.dumps(str(STATUS)))
source = source.replace('    private func installMenus()', methods + '    private func installMenus()', 1)
(CACHE / 'main.swift').write_text(source)
plist = plistlib.loads((ROOT / 'apps/macos/Info.plist').read_bytes())
plist['CFBundleIdentifier'] = 'top.mcsog.coursewatch.performance'
plist['CFBundleName'] = 'CourseWatch Performance'
(APP / 'Contents/Info.plist').write_bytes(plistlib.dumps(plist))
for name, target in [('node', pathlib.Path(subprocess.check_output(['which','node'],text=True).strip()))]:
    link = RES / name
    if link.is_symlink(): link.unlink()
    link.symlink_to(target)
# Production static assets are resolved relative to process.cwd().
(RES / 'app' / 'dist').symlink_to(ROOT / 'dist', target_is_directory=True)
for name in ['MenuBarIcon.svg', 'AppIcon.icns']:
    candidates = list((ROOT / 'build/macos').glob(f'*/CourseWatch.app/Contents/Resources/{name}'))
    if candidates:
        (RES / name).write_bytes(candidates[-1].read_bytes())
print('Compiling isolated production AppKit code', flush=True)
subprocess.run(['xcrun','swiftc','-swift-version','5','-O','-target','arm64-apple-macosx14.0','-framework','AppKit','-framework','WebKit','-framework','UserNotifications','-framework','EventKit',str(CACHE/'main.swift'),'apps/macos/CalendarSync.swift','-o',str(APP/'Contents/MacOS/CourseWatch')],check=True)
subprocess.run(['codesign','--force','--deep','--sign','-',str(APP)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

class Usage(ctypes.Structure):
    _fields_=[('uuid',ctypes.c_ubyte*16)]+[(n,ctypes.c_uint64) for n in ['user','system','pkg_wakeups','interrupt_wakeups','pageins','wired','rss','footprint','start','exit']]
lib=ctypes.CDLL('/usr/lib/libproc.dylib')
responsible=lib.responsibility_get_pid_responsible_for_pid
responsible.argtypes=[ctypes.c_int]
responsible.restype=ctypes.c_int
def process_table():
    rows={}
    for line in subprocess.check_output(['ps','-axo','pid=,ppid=,comm='],text=True).splitlines():
        pid,ppid,name=line.strip().split(None,2)
        rows[int(pid)]={'parent':int(ppid),'name':name}
    return rows

def sample(root, table, mappings):
    members={root}
    for _ in range(12):
        new=members|{p for p,r in table.items() if r['parent'] in members}|{p for p,r in mappings.items() if r in members}
        if new==members: break
        members=new
    result={}
    for pid in members:
        u=Usage()
        if lib.proc_pid_rusage(pid,0,ctypes.byref(u))==0:
            result[pid]={'cpu_ns':u.user+u.system,'rss':u.rss,'footprint':u.footprint,'wakeups':u.pkg_wakeups,'start':u.start}
    return result

existing=[p for p,r in process_table().items() if r['name']=='/Applications/CourseWatch.app/Contents/MacOS/CourseWatch']
# LaunchServices gives the temporary app its own process responsibility identity.
# Direct subprocess launch inherits the terminal/agent identity for WebKit XPC.
subprocess.run(['open','-n',str(APP)],check=True)
for _ in range(100):
    launched=[p for p,r in process_table().items() if r['name']==str(APP/'Contents/MacOS/CourseWatch')]
    if launched:break
    time.sleep(0.1)
else:raise RuntimeError('Temporary app did not launch')
class RunningApp:
    pid=launched[0]
    def poll(self):
        try:os.kill(self.pid,0);return None
        except ProcessLookupError:return 0
    def wait(self,timeout):
        end=time.monotonic()+timeout
        while self.poll() is None:
            if time.monotonic()>end:raise subprocess.TimeoutExpired('AppKit fixture',timeout)
            time.sleep(0.2)
        return 0
    def terminate(self):os.kill(self.pid,15)
proc=RunningApp()
collector=None
try:
    for _ in range(120):
        if STATUS.exists() and json.loads(STATUS.read_text()).get('ready'):break
        if proc.poll() is not None:raise RuntimeError('Temporary AppKit app exited')
        time.sleep(0.5)
    else:raise RuntimeError('Isolated backend did not become ready')
    total=3*(SECONDS+15)+10
    power=CACHE/'power.plist'; mapping=CACHE/'responsibility.txt'
    if WITH_POWER:
        command=shlex.join(['/usr/bin/powermetrics','--samplers','cpu_power,gpu_power','-i','5000','-n',str((total+4)//5),'-f','plist','-o',str(power)])
        apple='do shell script '+json.dumps(command)+' with administrator privileges'
        collector=subprocess.Popen(['osascript','-e',apple],stdout=(CACHE/'authorization.log').open('w'),stderr=subprocess.STDOUT)
        print('Waiting for system diagnostic authorization',flush=True)
        for _ in range(120):
            if power.exists() and power.stat().st_size>0:break
            if collector.poll() is not None:raise RuntimeError('Power sampler failed; see authorization.log')
            time.sleep(1)
        else:
            collector.terminate();collector.wait(timeout=10)
            raise RuntimeError('Power authorization timed out; request cancelled')
    rows=[]
    for stage in ['foreground','minimized','closed']:
        CONTROL.write_text(stage)
        time.sleep(15)
        status=json.loads(STATUS.read_text())
        assert status['ready']
        if stage=='foreground':assert status['renderer'] and status['visible']
        else:assert not status['renderer'],status
        print(f'{stage}: sampling {SECONDS} seconds; renderer={status["renderer"]}',flush=True)
        for _ in range(SECONDS//2):
            now=time.time(); table=process_table(); mappings={p:responsible(p) for p in table}
            if stage=='foreground':
                assert any(table.get(p,{}).get('name','').endswith('com.apple.WebKit.WebContent') for p in sample(proc.pid,table,mappings)), 'WebKit process attribution missing'
            row={'timestamp':now,'stage':stage,'native':json.loads(STATUS.read_text()),'isolated':sample(proc.pid,table,mappings)}
            if existing:row['existing']=sample(existing[0],table,mappings)
            rows.append(row)
            time.sleep(max(0,2-(time.time()-now)))
    (CACHE/'samples.json').write_text(json.dumps(rows))
    CONTROL.write_text('quit');proc.wait(timeout=20)
    if collector:collector.wait(timeout=60)
    if collector and collector.returncode:raise RuntimeError('Power sampler failed')
    # Extract only aggregate numbers. Raw plist contains unrelated process names and stays local.
    powers=[]
    for block in (power.read_bytes().split(b'\0') if WITH_POWER else []):
        if not block.strip():continue
        p=plistlib.loads(block)
        stamp=p['timestamp'].replace(tzinfo=datetime.timezone.utc).timestamp()
        powers.append({'timestamp':stamp,**{k:p['processor'][k] for k in ['cpu_power','gpu_power','ane_power','combined_power']}})
    def stats(values):
        return {'mean':statistics.mean(values),'min':min(values),'max':max(values)} if values else None
    report={'version':json.loads((ROOT/'package.json').read_text())['version'],'date':RUN_DATE,'startedAt':datetime.datetime.fromtimestamp(rows[0]['timestamp'],datetime.timezone.utc).isoformat(),'endedAt':datetime.datetime.fromtimestamp(rows[-1]['timestamp'],datetime.timezone.utc).isoformat(),'machine':subprocess.check_output(['sysctl','-n','hw.model'],text=True).strip(),'chip':subprocess.check_output(['sysctl','-n','machdep.cpu.brand_string'],text=True).strip(),'memoryBytes':int(subprocess.check_output(['sysctl','-n','hw.memsize'],text=True)),'macOS':subprocess.check_output(['sw_vers','-productVersion'],text=True).strip(),'secondsPerState':SECONDS,'sampleIntervalSeconds':2,'syntheticSchedules':100,'powerCollected':WITH_POWER,'attribution':'process descendants plus macOS process responsibility (includes WebKit and decoder XPC)','existingAppVersion':plistlib.loads(pathlib.Path('/Applications/CourseWatch.app/Contents/Info.plist').read_bytes()).get('CFBundleShortVersionString') if existing else None,'states':{}}
    for stage in ['foreground','minimized','closed']:
        selected=[r for r in rows if r['stage']==stage]
        data={'samples':len(selected),'rendererSamples':sum(r['native']['renderer'] for r in selected),'activeSamples':sum(r['native']['active'] for r in selected)}
        for group in ['isolated','existing']:
            if group not in selected[0]:continue
            cpu=[];wake=[]
            for a,b in zip(selected,selected[1:]):
                dt=b['timestamp']-a['timestamp'];common=set(a[group])&set(b[group]);same=[p for p in common if a[group][p]['start']==b[group][p]['start']]
                cpu.append(sum(b[group][p]['cpu_ns']-a[group][p]['cpu_ns'] for p in same)/1e9/dt*100)
                wake.append(sum(b[group][p]['wakeups']-a[group][p]['wakeups'] for p in same)/dt)
            data[group]={'cpuPercentOneCore':stats(cpu),'packageIdleWakeupsPerSecond':stats(wake),'rssMiB':stats([sum(p['rss'] for p in r[group].values())/1048576 for r in selected]),'footprintMiB':stats([sum(p['footprint'] for p in r[group].values())/1048576 for r in selected]),'processCount':stats([len(r[group]) for r in selected])}
        scoped=[p for p in powers if selected[0]['timestamp']<=p['timestamp']<=selected[-1]['timestamp']]
        if WITH_POWER:
            data['systemPowerWatts']={k:stats([p[k]/1000 for p in scoped]) for k in ['cpu_power','gpu_power','ane_power','combined_power']};data['powerSamples']=len(scoped)
        report['states'][stage]=data
    out=ROOT/f'docs/verification/macos-performance-{RUN_DATE}.json'
    out.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('Saved '+str(out.relative_to(ROOT)),flush=True)
finally:
    if proc.poll() is None:
        CONTROL.write_text('quit')
        try:proc.wait(timeout=20)
        except subprocess.TimeoutExpired:proc.terminate();proc.wait(timeout=10)
    # Each privileged sampler has a fixed sample limit and exits by itself.
    if collector and collector.poll() is None:
        print('Waiting for the finite privileged diagnostic to exit',flush=True)
        collector.wait(timeout=3*(SECONDS+15)+60)
    subprocess.run(['sudo','-k'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    print('Diagnostic ended; no persistent privileges installed; sudo cache invalidated',flush=True)
