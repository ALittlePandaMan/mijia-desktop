import rules from './device-capability-rules.json';
import type {Property,Service} from './types';
const key=(text:string)=>text.trim().toLowerCase().replace(/[\s_.-]+/g,'');
const choices:Record<string,string>={
 on:'开启',off:'关闭',true:'是',false:'否',auto:'自动',automatic:'自动',manual:'手动',normal:'标准',standard:'标准',smart:'智能',low:'低档',middle:'中档',medium:'中档',high:'高档',weak:'弱',strong:'强',none:'未确定',null:'未设置',other:'其他',custom:'自定义',userdefined:'自定义',invalid:'无效',
 idle:'空闲',working:'运行中',busy:'运行中',paused:'已暂停',pause:'暂停',stopped:'已停止',stop:'停止',playing:'播放中',play:'播放',standby:'待机',sleep:'睡眠',silent:'静音',favorite:'喜爱',open:'打开',opened:'已打开',close:'关闭',closed:'已关闭',day:'日间',night:'夜间',local:'本机',
 cool:'制冷',heat:'制热',dry:'除湿',fan:'送风',defog:'除雾',quickdefog:'快速除雾',quickheat:'快速制热',heating:'制热中',ventilation:'换气',blow:'吹风',
 noone:'无人',hasone:'有人',hassomeone:'有人',haspeople:'有人',occupied:'有人',unoccupied:'无人',presence:'有人',absence:'无人',quickcheck:'快速检测',detected:'已检测到',notdetected:'未检测到',
 error:'故障',fault:'故障',nofaults:'无故障',nofault:'无故障',preheating:'预热中',selfinspection:'自检中',expiryofequipmentlife:'设备寿命已到期',alarming:'报警中',alarm:'报警中',safe:'正常',
 charging:'充电中',notcharging:'未充电',full:'已充满',charged:'已充满',chargingcompleted:'充电完成',cleaning:'清扫中',sweeping:'清扫中',returning:'回充中',docking:'回充中',
 delay:'预约中',cooking:'烹饪中',cookingcompleted:'烹饪完成',turnpotpaused:'翻锅暂停',keepwarm:'保温中',keepwarmpaused:'保温暂停',keepwarmcompleted:'保温结束',quickbaking:'快烤',degrease:'脱脂',tenderroast:'嫩烤',duringrefinedroasting:'精烤中',waterfillingtip:'请加水',testing:'检测中',
 frenchfries:'薯条',chickenwing:'鸡翅',sweetpotato:'红薯',eggtart:'蛋挞',steak:'牛排',porkbelly:'五花肉',shrimp:'虾',cake:'蛋糕',pizza:'披萨',driedfruit:'果干',defrost:'解冻',reheat:'复热',fineroast:'精烤',quickroast:'快烤',
 ntcdisconnect:'温度传感器断开',ntcshortcircuit:'温度传感器短路',ntcfailure:'温度传感器故障',directwind:'直吹风',straightwind:'直吹风',naturalwind:'自然风',sleepwind:'睡眠风',smartwind:'智能风',
 soft:'柔和',bright:'明亮',warm:'暖色',cold:'冷色',white:'白光',warmwhite:'暖白光',coolwhite:'冷白光',reading:'阅读',movie:'观影',relax:'放松',
 spin:'脱水',wash:'洗涤',rinse:'漂洗',drying:'烘干',washing:'洗涤中',rinsing:'漂洗中',spinning:'脱水中',finished:'已完成',completed:'已完成',running:'运行中',ready:'就绪',
 eco:'节能',turbo:'强力',quiet:'静音',min:'最低',max:'最高',cooling:'制冷中',freezing:'冷冻',refrigerating:'冷藏',
};
const services:Record<string,string>={'ptc-bath-heater':'浴霸','bath-heater':'浴霸',light:'照明',fan:'风扇','ceiling-fan':'风扇灯','fan-control':'风速','air-conditioner':'空调','fridge-chamber':'温区',fridge:'冰箱',switch:'开关',outlet:'插座','power-consumption':'用电信息',battery:'电量',environment:'环境','temperature-humidity-sensor':'温湿度','occupancy-sensor':'人体存在','magnet-sensor':'门窗传感器','gas-sensor':'燃气传感器','smoke-sensor':'烟雾传感器','air-monitor':'空气质量','air-fryer':'空气炸锅','play-control':'播放控制',speaker:'音箱',projector:'投影仪',television:'电视','physical-controls-locked':'童锁','camera-control':'摄像机','water-purifier':'净水器','water-dispenser':'饮水机',washer:'洗衣机',vacuum:'扫地机器人',humidifier:'加湿器',dehumidifier:'除湿机',ventilator:'新风机','fresh-air':'新风机',airer:'晾衣机'};
Object.assign(choices,{locked:'已上锁',unlocked:'已开锁',indoor:'门内',outdoor:'门外',mobilephone:'手机',fingerprint:'指纹',password:'密码',face:'人脸',fingervein:'指静脉',palmprint:'掌纹',lockkey:'机械钥匙',lock:'上锁',unlock:'开锁',nofire:'未点火',burning:'燃烧中'});
Object.assign(services,{hood:'烟机','kitchen-stove':'灶具',screen:'屏幕','indicator-light':'指示灯',alarm:'提示音','air-purifier-favorite':'喜爱风速','motor-speed':'风机','ambient-light':'氛围灯',doorbell:'门铃','video-doorbell':'可视门铃','door-lock-camera':'门锁摄像头','lock-volume-management':'门锁声音','customized-wifi-lock':'门锁设置'});
export function deviceChoiceLabel(description:string,fallback?:string,context?:'state'):string{
 if(/[\u3400-\u9fff]/.test(description))return description;
 const normalized=key(description),known=choices[normalized];if(context==='state'&&normalized==='normal')return '正常';if(known)return known;
 const level=/^(?:level|gear|speed)(\d+)$/i.exec(normalized);if(level)return `${level[1]}档`;
 const input=/^hdmi(\d*)$/.exec(normalized);if(input)return `高清接口${input[1]?' '+input[1]:''}`;
 if(/^[+\-−]?\d+(?:\.\d+)?(?:[℃°%]|\s*(?:K|W|V|A))?$/.test(description.trim()))return description.trim();
 return fallback??'未识别状态';
}
/** Translate metadata only. Device names, SSIDs, client remarks and other user
 * strings never pass through this helper. */
export function devicePropertyLabel(property:Property,preferred?:string):string{
 const label=preferred??property.description;
 if(/[\u3400-\u9fff]/.test(label))return label;
 return (rules.labels as Record<string,string>)[property.name]??({'volume':'音量','mute':'静音','input-control':'输入源','playing-state':'播放状态','blow':'吹风','heating':'制热','ventilation':'换气','heat-level':'制热档位','off-delay':'延时关闭','target-time':'烹饪时间','left-time':'剩余时间','auto-keep-warm':'自动保温','sweep-mode':'清扫模式','suction-state':'吸力'} as Record<string,string>)[property.name]??'设备状态';
}
export function deviceServiceLabel(service:Pick<Service,'name'|'description'>):string{
 if(/[\u3400-\u9fff]/.test(service.description))return service.description;
 const suffix=service.description.match(/\d+$/)?.[0]??'';
 return `${services[service.name]??(rules.categories as Record<string,{title:string}>)[service.name]?.title??'设备功能'}${suffix}`;
}
export function deviceUnit(unit:string|null|undefined):string{
 return ({celsius:'℃',fahrenheit:'℉',kelvin:'K',percentage:'%',percent:'%',arcdegrees:'°',arcdegress:'°',lux:'lx',ppm:'ppm',second:'秒',seconds:'秒',minute:'分钟',minutes:'分钟',hour:'小时',hours:'小时',day:'天',days:'天',volt:'V',ampere:'A',watt:'W',kilowatt:'kW','watt-hour':'Wh','kilowatt-hour':'kWh',kilogram:'kg',gram:'g',meter:'m',metre:'m',calorie:'卡路里',pascal:'Pa',megapascal:'MPa',MByte:'MB','micrograms-per-cubic-meter':'μg/m³','mg/m3':'mg/m³','μg/m3':'μg/m³',none:''} as Record<string,string>)[unit??'none']??unit??'';
}
