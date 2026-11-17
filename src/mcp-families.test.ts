import {describe,it,expect} from 'vitest';
import {mcpHomeSelected,selectMcpHome} from './application-settings';
describe('MCP household preferences',()=>{
 it('includes current and newly discovered homes by default',()=>{const s={enabled:true,localPort:8765,excludedHomes:[]};expect(mcpHomeSelected(s,'account','old')).toBe(true);expect(mcpHomeSelected(s,'account','new')).toBe(true);expect(mcpHomeSelected(s,null,'old')).toBe(false);});
 it('remembers an exclusion across disappearance and scopes it to the account',()=>{const s={enabled:true,localPort:8765,excludedHomes:[]};selectMcpHome(s,'a','home',false);expect(mcpHomeSelected(s,'a','home')).toBe(false);expect(mcpHomeSelected(s,'b','home')).toBe(true);selectMcpHome(s,'a','home',false);expect(s.excludedHomes).toHaveLength(1);selectMcpHome(s,'a','home',true);expect(mcpHomeSelected(s,'a','home')).toBe(true);});
});
