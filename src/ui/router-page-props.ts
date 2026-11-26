import type {Device,DevicePanel} from '../types';
import type {RouterState} from '../router';

export interface RouterPageProps {
 device:Device;panel?:DevicePanel;state:RouterState;artwork:()=>HTMLElement;back:()=>void;
}
