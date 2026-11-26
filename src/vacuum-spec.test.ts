import {describe, expect, it, vi} from 'vitest';
import {SpecVacuumState, vacuumSettingEnabled} from './vacuum';
import {specVacuumMapEligible, vacuumPreviewChoices, vacuumPrimaryAction, vacuumSpecReport, vacuumStartModes, vacuumStationActions, vacuumStationChoices} from './vacuum-spec';
import type {Action, DevicePanel, Json, Property} from './types';
import lambotSpec from '../src-tauri/src/fixtures/catalog/vacuum--lambot.vacuum.lambot.json';

const model = 'viomi.vacuum.v11';
const context = {homeId:'home',generation:2,did:'robot'};
const property = (siid: number, piid: number, name: string, choices: [Json,string,string?][], value: Json, writable = true): Property => ({
  siid,piid,name,description:name,format:'uint8',access:writable ? ['read','write'] : ['read'],code:0,value,
  valueList:choices.map(([value,description,localizedDescription]) => ({value,description,localizedDescription})),
});
const action = (siid: number, aiid: number, name: string): Action => ({siid,aiid,name,description:name,in:[],out:[]});

function fixture(status = 1, mode = 1): DevicePanel {
  return {did:context.did,model,specType:'urn:miot-spec-v2:device:vacuum:0000A006:viomi-v11:2',services:[
    {siid:2,name:'vacuum',description:'扫地机',properties:[
      property(2,1,'status',[[1,'Idle'],[2,'Paused'],[3,'Sweeping'],[4,'Error','暂停'],[5,'Charging']],status,false),
      property(2,2,'fault',[[0,'No Faults']],0,false),
      property(2,7,'mode',[[0,'Silent'],[1,'Basic'],[2,'Strong'],[3,'Full Speed']],1),
      property(2,16,'wdr-mode',[[0,'0','扫地'],[1,'1','扫拖'],[2,'2','拖地']],mode),
      property(2,21,'target-water-level',[[0,'1挡'],[1,'2挡'],[2,'3挡']],0),
    ],actions:[action(2,1,'start-sweep'),action(2,3,'pause'),action(2,8,'start-mop')]},
    {siid:3,name:'battery',description:'电池',properties:[],actions:[action(3,1,'start-charge')]},
  ]};
}

describe('vacuum model bindings', () => {
  it('uses published mode and level values and distinguishes a charging dock from base-station features', () => {
    const report = vacuumSpecReport(fixture());
    expect(report.settings.mode?.choices.map(choice=>[choice.label,choice.value])).toEqual([['只扫地',0],['扫拖同步',1],['只拖地',2]]);
    expect(report.settings.suction?.choices.map(choice=>choice.label)).toEqual(['安静','标准','强力','超强']);
    expect(report.settings.water?.choices.map(choice=>choice.value)).toEqual([0,1,2]);
    expect(vacuumSettingEnabled(vacuumSpecReport(fixture(1,0)),'water')).toBe(false);
    expect(vacuumPrimaryAction(vacuumSpecReport(fixture(1,2)))?.action.aiid).toBe(8);
    expect(report.station).toBe(false);
    expect(vacuumStationActions(report)).toEqual([]);
  });

  it('omits unsupported and ambiguous settings and retains verified station controls', () => {
    const panel = fixture(5);
    const [clean] = panel.services;
    clean.properties[2].access = ['read'];
    clean.properties.push({...clean.properties[3]});
    clean.actions.push(action(2,11,'start-mop-wash'));
    const report = vacuumSpecReport(panel);
    expect(Object.keys(report.settings)).toEqual(['water']);
    expect(report.station).toBe(true);
    expect(vacuumStationActions(report).map(a=>a.role)).toEqual(['wash']);
    expect(vacuumSpecReport(fixture(4)).phase).toBe('blocked');
    expect(specVacuumMapEligible(panel)).toBe(false);
  });

  it('exposes only supported station commands and requires observed docking and cycle state',()=>{
    const panel=fixture();
    const [clean,battery]=panel.services;
    clean.properties[0].valueList!.push({value:6,description:'Go Wash'},{value:7,description:'Charging Completed'});
    const station=property(2,22,'base-station-working-status',[[0,'Idle'],[1,'The Mop Pad Is Being Cleaned'],[2,'The Mop Pad Is Being Dried']],0,false);
    clean.properties.push(station);
    clean.actions.push(...['start-mop-wash','stop-mop-wash','start-dry','stop-dry'].map((name,i)=>action(2,11+i,name)));
    const choices=()=>vacuumStationChoices(vacuumSpecReport(panel)).map(({role,enabled})=>[role,enabled]);
    expect(choices()).toEqual([['dock',true],['wash',false],['dry',false]]);
    battery.properties.push(property(3,2,'charging-state',[[0,'Not Charging'],[1,'Charging']],1,false));
    expect(choices()).toEqual([['wash',true],['dry',true]]);
    clean.properties[0].value=6;
    expect(choices()).toEqual([['dock',false],['wash',false],['dry',false]]);
    clean.properties[0].value=7;
    expect(choices()).toEqual([['wash',true],['dry',true]]);
    station.value=1;
    expect(choices()).toEqual([['stopWash',true],['dry',false]]);
    station.value=2;
    expect(choices()).toEqual([['wash',false],['stopDry',true]]);
    station.code=-1;
    expect(choices()).toEqual([['wash',false],['dry',false]]);
  });

  it('picks supported preview defaults and still locks a confirmed fault', () => {
    const panel = fixture(1,0);
    const [status, fault, suction, mode, water] = panel.services[0].properties;
    panel.services[0].properties[1] = property(2,2,'fault',[[0,'Err0','无故障'],[1,'Err1','请装回尘盒']],0,false);
    expect(vacuumPreviewChoices(vacuumSpecReport(panel))).toEqual([[mode,1],[suction,1],[water,1]]);
    expect(vacuumSpecReport(panel).settings.mode?.value).toBe(0);
    expect(vacuumSpecReport(panel).blocked).toBe(false);
    panel.services[0].properties[1].value=1;
    expect(vacuumSpecReport(panel).blocked).toBe(true);
    panel.services[0].properties[1]=fault;
    status.code=-1;
    expect(vacuumSpecReport(panel).phaseRead).toBe(false);
    status.code=0;
    panel.services[0].properties.push({...fault,piid:19});
    expect(vacuumSpecReport(panel).blocked).toBe(true);
  });

  it('keeps cleaning disabled when the published state only reports OK', async () => {
    const kind = (type: string) => type.split(':')[3];
    const panel: DevicePanel = {did:context.did,model:'lambot.vacuum.lambot',specType:lambotSpec.type,
      services:lambotSpec.services.map(service=>({siid:service.iid,name:kind(service.type),description:service.description,
        properties:service.properties.map(p=>{
          const choices='value-list' in p?p['value-list']:undefined;
          return {siid:service.iid,piid:p.iid,name:kind(p.type),description:p.description,
            format:p.format,access:p.access,code:0,value:choices?.[0].value,valueList:choices};
        }),
        actions:(service.actions??[]).map(a=>action(service.iid,a.iid,kind(a.type))),
      }))};
    const report=vacuumSpecReport(panel);
    expect(report).toMatchObject({phase:'unknown',phaseRead:false});
    const start=report.actions['vacuum.start-sweep'];
    expect(start).toMatchObject({siid:371,aiid:129});
    const send=vi.fn(),state=new SpecVacuumState({read:vi.fn(),readMap:vi.fn(),send},()=>{},()=>{});
    state.bind(context,'catalog-fixture',panel,false);
    try{
      await state.run({role:'start',action:start,target:'cleaning'});
      expect(send).not.toHaveBeenCalled();
    }finally{state.close();}
  });

  it('selects a documented mode-specific start action locally on models without a mode property', async () => {
    const panel = fixture();
    panel.services[0].properties = panel.services[0].properties.filter(property => property.name !== 'wdr-mode');
    const send = vi.fn().mockResolvedValue({panel:fixture(3),verified:true,message:''});
    const state = new SpecVacuumState({read:vi.fn(),readMap:vi.fn(),send},()=>{},()=>{});
    state.bind(context,'account',panel,false);
    const modes = vacuumStartModes(state.report!);
    expect(modes.map(choice=>choice.label)).toEqual(['清扫','只拖地']);
    expect(state.report?.startMode).toBe(modes[0].value);
    state.selectStartMode(modes[1].value);
    expect(send).not.toHaveBeenCalled();
    await state.run(vacuumPrimaryAction(state.report!)!);
    expect(send.mock.calls[0][1].action.aiid).toBe(8);
    state.close();
  });

  it('submits a changed mode before start, supports the next action immediately, and isolates stale responses', async () => {
    let ack!: (value: {panel:DevicePanel;verified:boolean;message:string}) => void;
    let started!: (value: {panel:DevicePanel;verified:boolean;message:string}) => void;
    const send = vi.fn().mockImplementationOnce(()=>new Promise(resolve=>ack=resolve))
      .mockImplementationOnce(()=>new Promise(resolve=>started=resolve))
      .mockResolvedValue({panel:fixture(2,2),verified:true,message:''});
    const state = new SpecVacuumState({read:vi.fn().mockResolvedValue(fixture()),readMap:vi.fn(),send},()=>{},()=>{});
    state.bind(context,'account-a',fixture(),false);
    const setting = state.select('mode',state.report!.settings.mode!.property,2);
    expect(state.report!.settings.mode?.value).toBe(2);
    const starting = state.run(vacuumPrimaryAction(state.report!)!);
    expect(state.report?.phase).toBe('cleaning');
    const pausing = state.run(vacuumPrimaryAction(state.report!)!);
    expect(state.report?.phase).toBe('paused');
    await Promise.resolve();
    expect(send).toHaveBeenCalledTimes(1);
    ack({panel:fixture(),verified:false,message:''});
    await setting;
    await vi.waitFor(()=>expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1][1].action.aiid).toBe(8);
    started({panel:fixture(3,2),verified:true,message:''});
    await Promise.all([starting,pausing]);
    await vi.waitFor(()=>expect(send).toHaveBeenCalledTimes(3));
    expect(state.report?.phase).toBe('paused');
    state.bind({...context,did:'second'},'account-b',{...fixture(),did:'second'},false);
    expect(state.report).toMatchObject({did:'second',phase:'idle'});
    state.close();
  });

  it('rolls back the first failed read and dependent projections without resending a command', async () => {
    vi.useFakeTimers();
    const missing = fixture();
    missing.services[0].properties[3].code = -1;
    const send = vi.fn().mockResolvedValue({panel:fixture(),verified:false,message:''});
    const state = new SpecVacuumState({read:vi.fn().mockResolvedValue(missing),readMap:vi.fn(),send},()=>{},()=>{});
    try {
      state.bind(context,'account',fixture(),false);
      await state.select('mode',state.report!.settings.mode!.property,2);
      await state.run(vacuumPrimaryAction(state.report!)!);
      expect(state.report?.phase).toBe('cleaning');
      await vi.advanceTimersByTimeAsync(1000);
      expect(state.report?.phase).toBe('idle');
      expect(state.report?.settings.mode?.value).toBeUndefined();
      expect(send).toHaveBeenCalledTimes(2);
    } finally { state.close();vi.useRealTimers(); }
  });
});
