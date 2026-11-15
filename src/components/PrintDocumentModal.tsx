import React from 'react';
import { Printer, X } from 'lucide-react';
import type { CompanySettings } from '../db/types';
import { printCurrentViewAsPdf } from '../utils/print';

interface PrintDocumentModalProps {
  open: boolean;
  title: string;
  fileName: string;
  settings?: CompanySettings;
  onClose: () => void;
  children: React.ReactNode;
}

export const PrintDocumentModal: React.FC<PrintDocumentModalProps> = ({
  open,
  title,
  fileName,
  settings,
  onClose,
  children,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/60 p-4 print:static print:bg-white print:p-0">
      <div className="no-print mx-auto mb-3 flex w-full max-w-4xl items-center justify-between rounded-lg border border-slate-200 bg-white px-5 py-3 shadow-md">
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              printCurrentViewAsPdf(fileName, { companyName: settings?.companyName })
            }
            className="inline-flex items-center gap-2 rounded-md bg-[#0F1E36] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#1a2f52]"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Imprimer / Exporter PDF (A4)</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
            aria-label="Fermer l’aperçu"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-4xl flex-1 overflow-y-auto rounded-lg bg-white p-8 shadow-xl print-area">
        {/* En-tête société A4 */}
        <div className="flex items-start justify-between border-b border-slate-300 pb-5">
          <div className="flex items-start gap-4">
            {settings?.logoDataUrl && (
              <img
                src={settings.logoDataUrl}
                alt={settings.companyName}
                className="h-16 w-16 object-contain"
              />
            )}
            <div>
              <h1 className="text-lg font-bold text-slate-900">
                {settings?.companyName || 'Entreprise'}
              </h1>
              {settings?.address && (
                <p className="text-xs text-slate-600">{settings.address}</p>
              )}
              <p className="mt-1 text-xs text-slate-600">
                {[settings?.phone, settings?.email].filter(Boolean).join(' · ')}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                {[
                  settings?.nif ? `NIF : ${settings.nif}` : '',
                  settings?.nis ? `NIS : ${settings.nis}` : '',
                  settings?.rc ? `RC : ${settings.rc}` : '',
                  settings?.ai ? `AI : ${settings.ai}` : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </div>

          <div className="text-right">
            <div className="text-xs text-slate-500">
              Édité le {new Date().toLocaleDateString('fr-FR')}
            </div>
          </div>
        </div>

        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
};
