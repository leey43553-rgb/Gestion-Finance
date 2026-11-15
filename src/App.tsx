import React, { useEffect, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ensureDatabaseInitialized } from './db/database';
import { runElectronAutoBackup } from './services/backup';
import { useAppStore } from './store/useAppStore';
import { Layout } from './components/Layout';
import { OnboardingWizard } from './components/OnboardingWizard';
import { DashboardPage } from './pages/DashboardPage';
import { SettingsPage } from './pages/SettingsPage';
import { HelpPage } from './pages/HelpPage';
import { AboutPage } from './pages/AboutPage';
import { ContactsPage } from './pages/ContactsPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { ReceiptsPage } from './pages/ReceiptsPage';
import { ExpensesPage } from './pages/ExpensesPage';
import { TreasuryPage } from './pages/TreasuryPage';
import { BanksPage } from './pages/BanksPage';
import { IncomingChequesPage } from './pages/IncomingChequesPage';
import { OutgoingChequesPage } from './pages/OutgoingChequesPage';
import { ReportsPage } from './pages/ReportsPage';

export default function App() {
  const [dbReady, setDbReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const settings = useLiveQuery(() => db.settings.get('company_settings'));
  const setBackupWarning = useAppStore((s) => s.setBackupWarning);

  useEffect(() => {
    let active = true;

    ensureDatabaseInitialized()
      .then(async () => {
        if (!active) return;
        setDbReady(true);

        // Sauvegarde automatique au démarrage dans Electron
        if (window.electronAPI?.isElectron) {
          const res = await runElectronAutoBackup();
          if (!res.ok && active) {
            setBackupWarning(
              `Sauvegarde automatique au démarrage impossible : ${res.error || 'erreur disque'}.`
            );
          }
        }
      })
      .catch((err) => {
        if (!active) return;
        setInitError(
          err instanceof Error
            ? err.message
            : 'Erreur d’initialisation de la base locale IndexedDB.'
        );
      });

    // Sauvegarde automatique à la fermeture dans Electron
    let unsubscribeClose: (() => void) | undefined;
    if (window.electronAPI?.onRequestCloseBackup) {
      unsubscribeClose = window.electronAPI.onRequestCloseBackup(async () => {
        try {
          await runElectronAutoBackup();
        } finally {
          window.electronAPI?.notifyCloseBackupDone();
        }
      });
    }

    return () => {
      active = false;
      if (unsubscribeClose) unsubscribeClose();
    };
  }, [setBackupWarning]);

  if (initError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-lg border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-base font-semibold text-red-700">
            Erreur de démarrage de la base locale
          </h1>
          <p className="mt-2 text-sm text-slate-600">{initError}</p>
        </div>
      </div>
    );
  }

  if (!dbReady || !settings) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-500">
        Initialisation de Gestion Financière...
      </div>
    );
  }

  return (
    <HashRouter>
      {!settings.onboardingCompleted && <OnboardingWizard settings={settings} />}
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/tresorerie" element={<TreasuryPage />} />
          <Route path="/recettes" element={<ReceiptsPage />} />
          <Route path="/depenses" element={<ExpensesPage />} />
          <Route path="/factures-clients" element={<InvoicesPage mode="client" />} />
          <Route path="/factures-fournisseurs" element={<InvoicesPage mode="fournisseur" />} />
          <Route path="/clients" element={<ContactsPage mode="client" />} />
          <Route path="/fournisseurs" element={<ContactsPage mode="fournisseur" />} />
          <Route path="/banques" element={<BanksPage />} />
          <Route path="/cheques-recus" element={<IncomingChequesPage />} />
          <Route path="/cheques-emis" element={<OutgoingChequesPage />} />
          <Route path="/rapports" element={<ReportsPage />} />
          <Route path="/parametres" element={<SettingsPage />} />
          <Route path="/aide" element={<HelpPage />} />
          <Route path="/a-propos" element={<AboutPage />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
