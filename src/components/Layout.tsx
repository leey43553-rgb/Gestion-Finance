import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowUpRight,
  BookOpen,
  Building2,
  FileInput,
  FileSpreadsheet,
  FileText,
  HelpCircle,
  Info,
  Landmark,
  LayoutDashboard,
  PieChart,
  Receipt,
  Settings,
  Truck,
  Users,
  Wallet,
  AlertCircle,
  CheckCircle2,
  X,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { APP_NAME, APP_VERSION, DEVELOPER_BRAND } from '../constants/branding';
import { db, recordAudit } from '../db/database';
import { useAppStore } from '../store/useAppStore';

interface NavItem {
  to: string;
  label: string;
  icon: React.FC<{ className?: string }>;
}

const MAIN_NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Tableau de bord', icon: LayoutDashboard },
  { to: '/tresorerie', label: 'Trésorerie', icon: Wallet },
  { to: '/recettes', label: 'Recettes', icon: ArrowDownLeft },
  { to: '/depenses', label: 'Dépenses', icon: ArrowUpRight },
  { to: '/factures-clients', label: 'Factures clients', icon: FileText },
  { to: '/factures-fournisseurs', label: 'Factures fournisseurs', icon: Receipt },
  { to: '/clients', label: 'Clients', icon: Users },
  { to: '/fournisseurs', label: 'Fournisseurs', icon: Truck },
  { to: '/banques', label: 'Banques & comptes', icon: Landmark },
  { to: '/cheques-recus', label: 'Chèques reçus', icon: FileInput },
  { to: '/cheques-emis', label: 'Chèques émis', icon: FileSpreadsheet },
  { to: '/rapports', label: 'Rapports', icon: PieChart },
  { to: '/parametres', label: 'Paramètres', icon: Settings },
];

const ROUTE_TITLES: Record<string, string> = {
  '/': 'Tableau de bord',
  '/tresorerie': 'Trésorerie & Grand livre',
  '/recettes': 'Recettes & Paiements reçus',
  '/depenses': 'Dépenses',
  '/factures-clients': 'Factures clients',
  '/factures-fournisseurs': 'Factures fournisseurs',
  '/clients': 'Clients',
  '/fournisseurs': 'Fournisseurs',
  '/banques': 'Banques & comptes',
  '/cheques-recus': 'Chèques reçus',
  '/cheques-emis': 'Chèques émis & Chéquiers',
  '/rapports': 'Rapports & Exports',
  '/parametres': 'Paramètres',
  '/aide': 'Aide & Prise en main',
  '/a-propos': 'À propos',
};

export const Layout: React.FC = () => {
  const location = useLocation();
  const settings = useLiveQuery(() => db.settings.get('company_settings'));
  const { toasts, dismissToast, backupWarning, setBackupWarning, pushToast } = useAppStore();

  const currentTitle = ROUTE_TITLES[location.pathname] || 'Gestion Financière';
  const uiMode = settings?.uiMode || 'simple';

  const handleToggleUiMode = async () => {
    if (!settings) return;
    const nextMode = uiMode === 'simple' ? 'avance' : 'simple';
    await db.settings.update('company_settings', {
      uiMode: nextMode,
      updatedAt: new Date().toISOString(),
    });
    await recordAudit({
      action: 'MODIFICATION',
      entityType: 'parametres',
      entityId: 'uiMode',
      summary: `Basculement vers le mode ${nextMode === 'simple' ? 'Simple' : 'Avancé'}`,
    });
    pushToast({
      type: 'info',
      title: nextMode === 'simple' ? 'Mode Simple activé' : 'Mode Avancé activé',
      message:
        nextMode === 'simple'
          ? 'Affichage épuré pour les opérations courantes.'
          : 'Toutes les options fiscales, multi-devises et journaux sont affichés.',
    });
  };

  return (
    <div className="flex min-h-screen min-w-[1100px] bg-slate-50 text-slate-900 print:block print:min-w-0 print:bg-white">
      {/* Barre latérale bleu marine */}
      <aside className="no-print flex w-64 shrink-0 flex-col bg-[#0F1E36] text-slate-100">
        {/* Identité logicielle et entreprise */}
        <div className="border-b border-slate-800/80 px-5 py-4">
          <div className="flex items-center gap-3">
            {settings?.logoDataUrl ? (
              <img
                src={settings.logoDataUrl}
                alt={settings.companyName || 'Logo entreprise'}
                className="h-9 w-9 shrink-0 rounded bg-white object-contain p-0.5"
              />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-slate-800 text-slate-200">
                <Building2 className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-white">
                Gestion Financière
              </div>
              <div className="truncate text-xs text-slate-300">
                {settings?.companyName || 'Entreprise non configurée'}
              </div>
            </div>
          </div>
        </div>

        {/* Navigation principale (13 sections exactes) */}
        <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Menu principal">
          <ul className="space-y-0.5">
            {MAIN_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                        isActive
                          ? 'bg-[#1D4ED8] text-white'
                          : 'text-slate-200 hover:bg-slate-800/70 hover:text-white'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Liens utilitaires bas de barre */}
        <div className="border-t border-slate-800/80 px-3 py-3">
          <ul className="space-y-0.5">
            <li>
              <NavLink
                to="/aide"
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#1D4ED8] text-white'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                  }`
                }
              >
                <HelpCircle className="h-4 w-4 shrink-0" />
                <span>Aide</span>
              </NavLink>
            </li>
            <li>
              <NavLink
                to="/a-propos"
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#1D4ED8] text-white'
                      : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                  }`
                }
              >
                <Info className="h-4 w-4 shrink-0" />
                <span>À propos</span>
              </NavLink>
            </li>
          </ul>
        </div>
      </aside>

      {/* Zone de contenu principale */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Barre supérieure simple à 3 zones */}
        <header className="no-print flex h-14 shrink-0 items-center justify-between gap-8 border-b border-slate-200 bg-white px-6">
          <h1 className="truncate text-lg font-semibold text-slate-900">{currentTitle}</h1>

          <div className="flex items-center gap-4 text-xs text-slate-500 whitespace-nowrap shrink-0">
            <span>Devise : {settings?.defaultCurrency || 'DZD'}</span>
            <span aria-hidden="true">·</span>
            <span>TVA par défaut : {settings?.defaultTvaRate ?? 19} %</span>
          </div>

          <div className="flex items-center gap-2 rounded-md bg-slate-100 p-1 shrink-0">
            <button
              type="button"
              onClick={() => uiMode !== 'simple' && handleToggleUiMode()}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                uiMode === 'simple'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Mode simple
            </button>
            <button
              type="button"
              onClick={() => uiMode !== 'avance' && handleToggleUiMode()}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                uiMode === 'avance'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Mode avancé
            </button>
          </div>
        </header>

        {/* Alerte d'échec de sauvegarde automatique */}
        {backupWarning && (
          <div className="no-print flex items-center justify-between gap-4 border-b border-red-200 bg-red-50 px-6 py-2.5 text-sm text-red-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
              <span>{backupWarning}</span>
            </div>
            <button
              type="button"
              onClick={() => setBackupWarning(null)}
              className="rounded p-1 text-red-600 hover:bg-red-100"
              aria-label="Fermer l’avertissement"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Contenu de la page */}
        <main className="flex-1 overflow-y-auto p-6 print:overflow-visible print:p-0">
          <Outlet />
        </main>

        {/* Pied de page permanent */}
        <footer className="no-print flex shrink-0 items-center justify-between border-t border-slate-200 bg-white px-6 py-2.5 text-xs text-slate-500">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-700">{APP_NAME}</span>
            <span aria-hidden="true">·</span>
            <span>Version {APP_VERSION}</span>
            <span aria-hidden="true">·</span>
            <span>{DEVELOPER_BRAND}</span>
          </div>
          <div className="flex items-center gap-3">
            <span>Outil de gestion financière hors-ligne (non certifié comptable)</span>
            <span aria-hidden="true">·</span>
            <NavLink to="/aide" className="inline-flex items-center gap-1 hover:text-slate-800">
              <BookOpen className="h-3.5 w-3.5" />
              <span>Aide</span>
            </NavLink>
          </div>
        </footer>
      </div>

      {/* Notifications Toasts */}
      {toasts.length > 0 && (
        <div className="no-print fixed right-5 bottom-12 z-50 flex w-96 flex-col gap-2">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`flex items-start gap-3 rounded-lg border bg-white p-3.5 shadow-lg ${
                toast.type === 'error'
                  ? 'border-red-200'
                  : toast.type === 'warning'
                  ? 'border-amber-200'
                  : toast.type === 'success'
                  ? 'border-emerald-200'
                  : 'border-slate-200'
              }`}
            >
              {toast.type === 'error' ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              ) : toast.type === 'warning' ? (
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-slate-900">{toast.title}</div>
                {toast.message && <div className="mt-0.5 text-xs text-slate-600">{toast.message}</div>}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Fermer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
