import { api } from './api';
import { isDesktop, sendDesktop } from './desktop';

export async function exportSystemLogs() {
  if (isDesktop) { sendDesktop('exportDiagnostics'); return; }
  const data = await api('diagnostics/export');
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'coursewatch-system-logs.json';
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
