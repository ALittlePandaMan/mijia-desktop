import {spawnSync} from 'node:child_process';
import path from 'node:path';
const check=process.argv.includes('--check');
const result=spawnSync('cargo',['test','--manifest-path','src-tauri/Cargo.toml','--no-default-features',...(check?['mcp_core::guide::tests::reference_document_is_current']:['mcp_core::guide::tests::export_reference','--','--ignored'])],{stdio:'inherit',env:{...process.env,MIJIA_MCP_REFERENCE_OUTPUT:path.resolve('docs/MCP_REFERENCE.md')}});
process.exit(result.status??1);
