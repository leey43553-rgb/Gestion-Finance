export async function printCurrentViewAsPdf(
  defaultFileName = 'document-gestion-financiere.pdf',
  options?: { companyName?: string; landscape?: boolean }
): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (window.electronAPI?.isElectron && window.electronAPI.printToPDF) {
    const res = await window.electronAPI.printToPDF({
      defaultFileName,
      companyName: options?.companyName,
      landscape: options?.landscape,
    });
    if (res.canceled) return { ok: true };
    if (!res.ok) return { ok: false, error: res.error || 'Erreur lors de l’export PDF.' };
    return { ok: true };
  }

  window.print();
  return { ok: true };
}
