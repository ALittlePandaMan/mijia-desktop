import type {Device} from '../types';
import type {RouterState} from '../router';

export interface RouterPageProps {
 device:Device;state:RouterState;artwork:()=>HTMLElement;back:()=>void;
}
