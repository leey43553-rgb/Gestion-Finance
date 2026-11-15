import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { APP_NAME, APP_VERSION, DEVELOPER_BRAND } from '../constants/branding';

export const AboutPage: React.FC = () => {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0F1E36] text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{APP_NAME}</h2>
            <p className="text-xs text-slate-500">
              Version {APP_VERSION} · Éditeur : {DEVELOPER_BRAND}
            </p>
          </div>
        </div>

        <div className="space-y-3 text-sm leading-relaxed text-slate-600">
          <p>
            <strong>Gestion Financière</strong> est un logiciel bureautique conçu pour la gestion quotidienne des petites et moyennes entreprises en Algérie : facturation, suivi des règlements clients et fournisseurs, trésorerie multi-banques, chéquiers, dépenses et rapports imprimables.
          </p>
          <p>
            <strong>Fonctionnement 100 % hors-ligne :</strong> toutes les informations (entreprises, opérations, logo, historique) sont enregistrées localement sur votre ordinateur. Aucune donnée ne transite par Internet.
          </p>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">
            <strong>Avertissement important :</strong> Ce logiciel est un outil interne de suivi et de gestion financière. Il ne constitue pas un logiciel de comptabilité agréé ni certifié au sens réglementaire officiel et ne remplace pas la tenue légale assurée par votre expert-comptable ou commissaire aux comptes.
          </div>
        </div>
      </div>
    </div>
  );
};
