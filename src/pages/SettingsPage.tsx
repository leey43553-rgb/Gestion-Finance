import React, { useEffect, useState } from 'react';
import {
  Building2,
  Database,
  Download,
  FolderOpen,
  History,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { DEVELOPER_BRAND } from '../constants/branding';
import { db, ensureDatabaseInitialized, recordAudit } from '../db/database';
import type { CurrencyConfig } from '../db/types';
import {
  exportFullBackupJson,
  restoreFromBackupJson,
  triggerBrowserJsonDownload,
  verifyAndParseBackupJson,
} from '../services/backup';
import { clearDemoData, loadDemoData } from '../services/demoData';
import { useAppStore } from '../store/useAppStore';
import type { ElectronBackupFile } from '../types/electron';
import { ConfirmDialog } from '../components/ConfirmDialog';

type SettingsTab = 'entreprise' | 'fiscalite' | 'sauvegardes' | 'donnees';

export const SettingsPage: React.FC = () => {
  const settings = useLiveQuery(() => db.settings.get('company_settings'));
  const auditLogs = useLiveQuery(() =>
    db.auditLogs.orderBy('timestamp').reverse().limit(100).toArray()
  );
  const pushToast = useAppStore((s) => s.pushToast);

  const [activeTab, setActiveTab] = useState<SettingsTab>('entreprise');

  // Formulaire Entreprise
  const [companyName, setCompanyName] = useState('');
  const [logoDataUrl, setLogoDataUrl] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [nif, setNif] = useState('');
  const [nis, setNis] = useState('');
  const [rc, setRc] = useState('');
  const [ai, setAi] = useState('');
  const [developerBrand, setDeveloperBrand] = useState('');

  // Fiscalité & Devises
  const [defaultCurrency, setDefaultCurrency] = useState('DZD');
  const [currencies, setCurrencies] = useState<CurrencyConfig[]>([]);
  const [defaultTvaRate, setDefaultTvaRate] = useState('19');
  const [invoicePrefix, setInvoicePrefix] = useState('FAC-');
  const [invoiceNextSeq, setInvoiceNextSeq] = useState('1');
  const [supplierInvoicePrefix, setSupplierInvoicePrefix] = useState('FF-');
  const [supplierInvoiceNextSeq, setSupplierInvoiceNextSeq] = useState('1');
  const [newCurrCode, setNewCurrCode] = useState('');
  const [newCurrName, setNewCurrName] = useState('');
  const [newCurrSymbol, setNewCurrSymbol] = useState('');
  const [newCurrRate, setNewCurrRate] = useState('1');

  // Sauvegardes
  const [backupFolder, setBackupFolder] = useState('');
  const [electronBackups, setElectronBackups] = useState<ElectronBackupFile[]>([]);
  const [pendingRestoreJson, setPendingRestoreJson] = useState<string | null>(null);
  const [pendingRestoreInfo, setPendingRestoreInfo] = useState<{
    companyName: string;
    exportedAt: string;
    recordCount: number;
  } | null>(null);

  // Confirmations
  const [confirmClearDemo, setConfirmClearDemo] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setCompanyName(settings.companyName);
    setLogoDataUrl(settings.logoDataUrl);
    setAddress(settings.address);
    setPhone(settings.phone);
    setEmail(settings.email);
    setNif(settings.nif);
    setNis(settings.nis);
    setRc(settings.rc);
    setAi(settings.ai);
    setDeveloperBrand(DEVELOPER_BRAND);
    setDefaultCurrency(settings.defaultCurrency);
    setCurrencies(settings.enabledCurrencies);
    setDefaultTvaRate(String(settings.defaultTvaRate));
    setInvoicePrefix(settings.invoicePrefix);
    setInvoiceNextSeq(String(settings.invoiceNextSeq));
    setSupplierInvoicePrefix(settings.supplierInvoicePrefix);
    setSupplierInvoiceNextSeq(String(settings.supplierInvoiceNextSeq));
    setBackupFolder(settings.backupFolder);
  }, [settings]);

  const refreshElectronBackups = async (folder?: string) => {
    if (!window.electronAPI?.isElectron) return;
    const res = await window.electronAPI.listBackups(folder ?? backupFolder);
    if (res.ok) {
      setElectronBackups(res.backups || []);
      if (!backupFolder && res.directory) {
        setBackupFolder(res.directory);
      }
    }
  };

  useEffect(() => {
    if (activeTab === 'sauvegardes' && window.electronAPI?.isElectron) {
      refreshElectronBackups();
    }
  }, [activeTab]);

  if (!settings) {
    return <div className="p-6 text-sm text-slate-500">Chargement des paramètres...</div>;
  }

  const handleSaveCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) {
      pushToast({ type: 'error', title: 'Champ obligatoire', message: 'Le nom de l’entreprise est requis.' });
      return;
    }
    const before = { companyName: settings.companyName, nif: settings.nif, rc: settings.rc };
    await db.settings.update('company_settings', {
      companyName: companyName.trim(),
      logoDataUrl,
      address: address.trim(),
      phone: phone.trim(),
      email: email.trim(),
      nif: nif.trim(),
      nis: nis.trim(),
      rc: rc.trim(),
      ai: ai.trim(),
      developerBrand: DEVELOPER_BRAND,
      updatedAt: new Date().toISOString(),
    });
    await recordAudit({
      action: 'MODIFICATION',
      entityType: 'parametres',
      entityId: 'entreprise',
      summary: `Mise à jour des informations de l’entreprise (${companyName.trim()})`,
      before,
      after: { companyName: companyName.trim(), nif: nif.trim(), rc: rc.trim() },
    });
    pushToast({ type: 'success', title: 'Paramètres enregistrés' });
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024 * 2) {
      pushToast({ type: 'error', title: 'Fichier trop volumineux', message: 'Taille maximale : 2 Mo.' });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSaveFiscal = async (e: React.FormEvent) => {
    e.preventDefault();
    const tva = Number(defaultTvaRate.replace(',', '.'));
    const nextSeq = parseInt(invoiceNextSeq, 10);
    const nextSupSeq = parseInt(supplierInvoiceNextSeq, 10);

    if (!Number.isFinite(tva) || tva < 0 || tva > 100) {
      pushToast({ type: 'error', title: 'TVA invalide', message: 'Le taux de TVA doit être entre 0 et 100 %.' });
      return;
    }
    if (!Number.isInteger(nextSeq) || nextSeq < 1 || !Number.isInteger(nextSupSeq) || nextSupSeq < 1) {
      pushToast({
        type: 'error',
        title: 'Séquence invalide',
        message: 'Les numéros de séquence doivent être des entiers positifs.',
      });
      return;
    }

    await db.settings.update('company_settings', {
      defaultCurrency,
      enabledCurrencies: currencies.map((c) =>
        c.code === defaultCurrency ? { ...c, enabled: true, rateToDzd: c.code === 'DZD' ? 1 : c.rateToDzd } : c
      ),
      defaultTvaRate: tva,
      invoicePrefix: invoicePrefix.trim() || 'FAC-',
      invoiceNextSeq: nextSeq,
      supplierInvoicePrefix: supplierInvoicePrefix.trim() || 'FF-',
      supplierInvoiceNextSeq: nextSupSeq,
      updatedAt: new Date().toISOString(),
    });

    await recordAudit({
      action: 'MODIFICATION',
      entityType: 'parametres',
      entityId: 'fiscalite',
      summary: `Mise à jour TVA (${tva}%), devise (${defaultCurrency}) et numérotation`,
    });

    pushToast({ type: 'success', title: 'Paramètres fiscaux et devises enregistrés' });
  };

  const handleAddCurrency = () => {
    const code = newCurrCode.trim().toUpperCase();
    const name = newCurrName.trim();
    const symbol = newCurrSymbol.trim() || code;
    const rate = Number(newCurrRate.replace(',', '.'));

    if (!/^[A-Z]{3}$/.test(code)) {
      pushToast({ type: 'error', title: 'Code devise invalide', message: 'Utilisez un code ISO à 3 lettres (ex: MAD, TND, CHF).' });
      return;
    }
    if (!name) {
      pushToast({ type: 'error', title: 'Nom requis', message: 'Indiquez le nom de la devise.' });
      return;
    }
    if (!Number.isFinite(rate) || rate <= 0) {
      pushToast({ type: 'error', title: 'Taux invalide', message: 'Le taux indicatif vers DZD doit être supérieur à 0.' });
      return;
    }
    if (currencies.some((c) => c.code === code)) {
      pushToast({ type: 'error', title: 'Devise existante', message: `La devise ${code} existe déjà.` });
      return;
    }

    setCurrencies((prev) => [...prev, { code, name, symbol, rateToDzd: rate, enabled: true }]);
    setNewCurrCode('');
    setNewCurrName('');
    setNewCurrSymbol('');
    setNewCurrRate('1');
  };

  const handleExportBackup = async () => {
    try {
      const { json } = await exportFullBackupJson();
      const stamp = new Date().toISOString().slice(0, 10);

      if (window.electronAPI?.isElectron) {
        const res = await window.electronAPI.saveBackup(json, 'manual', backupFolder);
        if (!res.ok) {
          pushToast({ type: 'error', title: 'Échec de la sauvegarde', message: res.error });
          return;
        }
        await refreshElectronBackups();
        pushToast({
          type: 'success',
          title: 'Sauvegarde enregistrée',
          message: res.fileName || 'Fichier JSON écrit sur le disque.',
        });
      } else {
        triggerBrowserJsonDownload(json, `gestion-financiere-sauvegarde-${stamp}.json`);
        pushToast({
          type: 'success',
          title: 'Sauvegarde téléchargée',
          message: `Fichier gestion-financiere-sauvegarde-${stamp}.json généré.`,
        });
      }

      await recordAudit({
        action: 'SAUVEGARDE',
        entityType: 'systeme',
        entityId: 'manual_backup',
        summary: 'Sauvegarde manuelle complète exportée',
      });
    } catch (err) {
      pushToast({
        type: 'error',
        title: 'Erreur lors de la sauvegarde',
        message: err instanceof Error ? err.message : 'Erreur inconnue.',
      });
    }
  };

  const prepareRestoreFromText = async (raw: string) => {
    const check = await verifyAndParseBackupJson(raw);
    if (!check.valid || !check.pkg) {
      pushToast({ type: 'error', title: 'Fichier de sauvegarde invalide', message: check.error });
      return;
    }
    setPendingRestoreJson(raw);
    setPendingRestoreInfo({
      companyName: check.pkg.companyName,
      exportedAt: check.pkg.exportedAt,
      recordCount: check.pkg.recordCount,
    });
  };

  const handleBrowserFileRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === 'string') {
        await prepareRestoreFromText(reader.result);
      }
    };
    reader.readAsText(file, 'utf-8');
    e.target.value = '';
  };

  const handleElectronRestorePick = async (filePath = '') => {
    if (!window.electronAPI?.restoreBackup) return;
    const res = await window.electronAPI.restoreBackup(filePath);
    if (res.canceled) return;
    if (!res.ok || !res.jsonContent) {
      pushToast({ type: 'error', title: 'Lecture impossible', message: res.error });
      return;
    }
    await prepareRestoreFromText(res.jsonContent);
  };

  const confirmRestore = async () => {
    if (!pendingRestoreJson) return;
    const res = await restoreFromBackupJson(pendingRestoreJson);
    setPendingRestoreJson(null);
    setPendingRestoreInfo(null);
    if (!res.ok) {
      pushToast({ type: 'error', title: 'Restauration annulée', message: res.error });
      return;
    }
    await ensureDatabaseInitialized();
    pushToast({
      type: 'success',
      title: 'Restauration réussie',
      message: `${res.recordCount} enregistrements restaurés (${res.companyName}).`,
    });
  };

  const handleSelectBackupFolder = async () => {
    if (!window.electronAPI?.selectFolder) return;
    const res = await window.electronAPI.selectFolder(backupFolder);
    if (res.ok && res.directory) {
      setBackupFolder(res.directory);
      await db.settings.update('company_settings', {
        backupFolder: res.directory,
        updatedAt: new Date().toISOString(),
      });
      await refreshElectronBackups(res.directory);
      pushToast({ type: 'success', title: 'Dossier de sauvegarde mis à jour', message: res.directory });
    }
  };

  const handleLoadDemo = async () => {
    await loadDemoData();
    pushToast({
      type: 'success',
      title: 'Données de démonstration chargées',
      message: 'Des données fictives algériennes ont été ajoutées pour tester l’application.',
    });
  };

  const handleClearDemo = async () => {
    setConfirmClearDemo(false);
    await clearDemoData();
    pushToast({
      type: 'info',
      title: 'Données de démonstration supprimées',
      message: 'Seules les données réelles saisies par votre entreprise sont conservées.',
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* Onglets */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            { id: 'entreprise', label: 'Entreprise & Logo', icon: Building2 },
            { id: 'fiscalite', label: 'Devises, TVA & Numérotation', icon: ShieldCheck },
            { id: 'sauvegardes', label: 'Sauvegardes & Restauration', icon: Database },
            { id: 'donnees', label: 'Données démo & Journal d’audit', icon: History },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap ${
                active ? 'bg-[#0F1E36] text-white' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Onglet 1 : Entreprise */}
      {activeTab === 'entreprise' && (
        <form onSubmit={handleSaveCompany} className="rounded-lg border border-slate-200 bg-white p-6 space-y-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Identité de l’entreprise</h2>
            <p className="mt-1 text-sm text-slate-500">
              Aucune donnée n’est figée dans le logiciel : modifiez ces champs à tout moment.
            </p>
          </div>

          <div className="flex items-center gap-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
            {logoDataUrl ? (
              <img
                src={logoDataUrl}
                alt="Logo entreprise"
                className="h-16 w-16 rounded border border-slate-200 bg-white object-contain p-1"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded border border-dashed border-slate-300 bg-white text-slate-400">
                <Building2 className="h-7 w-7" />
              </div>
            )}
            <div className="space-y-1.5">
              <div className="text-sm font-medium text-slate-800">Logo officiel (affiché sur factures et PDF)</div>
              <div className="flex items-center gap-3">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
                  <Upload className="h-3.5 w-3.5" />
                  <span>Importer une image</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={handleLogoUpload}
                    className="hidden"
                  />
                </label>
                {logoDataUrl && (
                  <button
                    type="button"
                    onClick={() => setLogoDataUrl('')}
                    className="text-xs font-medium text-red-600 hover:underline"
                  >
                    Supprimer le logo
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700">Nom / Raison sociale *</label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Téléphone</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-slate-700">Adresse complète</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">NIF</label>
              <input
                type="text"
                value={nif}
                onChange={(e) => setNif(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">NIS</label>
              <input
                type="text"
                value={nis}
                onChange={(e) => setNis(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Registre de Commerce (RC)</label>
              <input
                type="text"
                value={rc}
                onChange={(e) => setRc(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Article d’imposition (AI)</label>
              <input
                type="text"
                value={ai}
                onChange={(e) => setAi(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>
            {settings.uiMode === 'avance' && (
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-slate-700">
                  Marque éditeur affichée en pied de page
                </label>
                <input
                  type="text"
                  value={developerBrand}
                  onChange={(e) => setDeveloperBrand(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            )}
          </div>

          <div className="flex justify-end border-t border-slate-200 pt-4">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md bg-[#0F1E36] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a2f52]"
            >
              <Save className="h-4 w-4" />
              <span>Enregistrer les informations</span>
            </button>
          </div>
        </form>
      )}

      {/* Onglet 2 : Devises & Fiscalité */}
      {activeTab === 'fiscalite' && (
        <form onSubmit={handleSaveFiscal} className="rounded-lg border border-slate-200 bg-white p-6 space-y-6">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Devises, TVA & Numérotation</h2>
            <p className="mt-1 text-sm text-slate-500">
              Les taux de change indicatifs servent de valeur par défaut ; chaque opération conserve son propre taux historique.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-sm font-medium text-slate-700">Devise principale</label>
              <select
                value={defaultCurrency}
                onChange={(e) => setDefaultCurrency(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                {currencies.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name} ({c.symbol})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">TVA par défaut (%)</label>
              <input
                type="text"
                value={defaultTvaRate}
                onChange={(e) => setDefaultTvaRate(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Préfixe factures clients</label>
              <input
                type="text"
                value={invoicePrefix}
                onChange={(e) => setInvoicePrefix(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Prochain N° facture client</label>
              <input
                type="number"
                min={1}
                value={invoiceNextSeq}
                onChange={(e) => setInvoiceNextSeq(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Préfixe factures fournisseurs</label>
              <input
                type="text"
                value={supplierInvoicePrefix}
                onChange={(e) => setSupplierInvoicePrefix(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">Prochain N° facture fournisseur</label>
              <input
                type="number"
                min={1}
                value={supplierInvoiceNextSeq}
                onChange={(e) => setSupplierInvoiceNextSeq(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-800">Devises disponibles</h3>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <tr>
                    <th className="px-4 py-2.5">Active</th>
                    <th className="px-4 py-2.5">Code</th>
                    <th className="px-4 py-2.5">Nom</th>
                    <th className="px-4 py-2.5">Symbole</th>
                    <th className="px-4 py-2.5 text-right">Taux manuel vers DZD</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {currencies.map((c) => (
                    <tr key={c.code} className="hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <input
                          type="checkbox"
                          checked={c.enabled || c.code === defaultCurrency}
                          disabled={c.code === defaultCurrency}
                          onChange={(e) =>
                            setCurrencies((prev) =>
                              prev.map((item) =>
                                item.code === c.code ? { ...item, enabled: e.target.checked } : item
                              )
                            )
                          }
                        />
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-900">{c.code}</td>
                      <td className="px-4 py-2 text-slate-700">{c.name}</td>
                      <td className="px-4 py-2 text-slate-700">{c.symbol}</td>
                      <td className="px-4 py-2 text-right">
                        <input
                          type="number"
                          step="0.01"
                          min="0.0001"
                          disabled={c.code === 'DZD'}
                          value={c.rateToDzd}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value);
                            setCurrencies((prev) =>
                              prev.map((item) =>
                                item.code === c.code
                                  ? { ...item, rateToDzd: Number.isFinite(val) ? val : 1 }
                                  : item
                              )
                            );
                          }}
                          className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm tabular-nums disabled:bg-slate-100"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Ajout d'une devise supplémentaire */}
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div>
                <label className="block text-xs text-slate-600">Code (3 lettres)</label>
                <input
                  type="text"
                  maxLength={3}
                  value={newCurrCode}
                  onChange={(e) => setNewCurrCode(e.target.value.toUpperCase())}
                  placeholder="CHF"
                  className="mt-1 w-20 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                />
              </div>
              <div className="flex-1 min-w-[150px]">
                <label className="block text-xs text-slate-600">Nom</label>
                <input
                  type="text"
                  value={newCurrName}
                  onChange={(e) => setNewCurrName(e.target.value)}
                  placeholder="Franc suisse"
                  className="mt-1 w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600">Symbole</label>
                <input
                  type="text"
                  value={newCurrSymbol}
                  onChange={(e) => setNewCurrSymbol(e.target.value)}
                  placeholder="CHF"
                  className="mt-1 w-20 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600">Taux vers DZD</label>
                <input
                  type="text"
                  value={newCurrRate}
                  onChange={(e) => setNewCurrRate(e.target.value)}
                  className="mt-1 w-24 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-right tabular-nums"
                />
              </div>
              <button
                type="button"
                onClick={handleAddCurrency}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                <Plus className="h-4 w-4" />
                <span>Ajouter devise</span>
              </button>
            </div>
          </div>

          <div className="flex justify-end border-t border-slate-200 pt-4">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-md bg-[#0F1E36] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a2f52]"
            >
              <Save className="h-4 w-4" />
              <span>Enregistrer les réglages fiscaux</span>
            </button>
          </div>
        </form>
      )}

      {/* Onglet 3 : Sauvegardes & Restauration */}
      {activeTab === 'sauvegardes' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Sauvegarde & Restauration complète (JSON)
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Inclut toutes vos écritures, factures, chèques, paramètres et votre logo. Une sauvegarde de sécurité est créée automatiquement avant chaque restauration.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleExportBackup}
                className="inline-flex items-center gap-2 rounded-md bg-[#0F1E36] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a2f52]"
              >
                <Download className="h-4 w-4" />
                <span>Créer une sauvegarde maintenant</span>
              </button>

              {window.electronAPI?.isElectron ? (
                <button
                  type="button"
                  onClick={() => handleElectronRestorePick('')}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Upload className="h-4 w-4" />
                  <span>Restaurer depuis un fichier...</span>
                </button>
              ) : (
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                  <Upload className="h-4 w-4" />
                  <span>Restaurer un fichier JSON...</span>
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleBrowserFileRestore}
                    className="hidden"
                  />
                </label>
              )}
            </div>
          </div>

          {window.electronAPI?.isElectron ? (
            <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">
                    Sauvegardes automatiques (30 dernières conservées)
                  </h3>
                  <p className="text-xs text-slate-500">Dossier actif : {backupFolder}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectBackupFolder}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span>Changer de dossier</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => refreshElectronBackups()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Actualiser</span>
                  </button>
                </div>
              </div>

              {electronBackups.length === 0 ? (
                <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  Aucune sauvegarde trouvée dans ce dossier pour le moment.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                      <tr>
                        <th className="px-4 py-2">Fichier</th>
                        <th className="px-4 py-2">Type</th>
                        <th className="px-4 py-2">Date</th>
                        <th className="px-4 py-2 text-right">Taille</th>
                        <th className="px-4 py-2 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {electronBackups.map((b) => (
                        <tr key={b.filePath} className="hover:bg-slate-50">
                          <td className="px-4 py-2 font-medium text-slate-800">{b.fileName}</td>
                          <td className="px-4 py-2 text-slate-600">
                            {b.kind === 'auto' ? 'Automatique' : 'Manuelle'}
                          </td>
                          <td className="px-4 py-2 text-slate-600 tabular-nums">
                            {new Date(b.modifiedAt).toLocaleString('fr-FR')}
                          </td>
                          <td className="px-4 py-2 text-right text-slate-600 tabular-nums">
                            {(b.sizeBytes / 1024).toFixed(1)} Ko
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleElectronRestorePick(b.filePath)}
                              className="text-xs font-medium text-[#1D4ED8] hover:underline"
                            >
                              Restaurer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600">
              <strong>Note sur l’application Windows (.exe) :</strong> lorsque le logiciel tourne en mode bureau Electron, une sauvegarde automatique est enregistrée automatiquement à l’ouverture et à la fermeture dans <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">Documents\GestionFinanciere\Sauvegardes</code>.
            </div>
          )}
        </div>
      )}

      {/* Onglet 4 : Données démo & Journal d'audit */}
      {activeTab === 'donnees' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Données de démonstration fictives</h2>
              <p className="mt-1 text-sm text-slate-500">
                Chargez un jeu complet de données fictives algériennes (BNA, CPA, chéquier 0012345, factures, paiements partiels, dépenses) pour découvrir ou tester l’application.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleLoadDemo}
                className="inline-flex items-center gap-2 rounded-md bg-[#0F1E36] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a2f52]"
              >
                <Database className="h-4 w-4" />
                <span>
                  {settings.isDemoDataLoaded
                    ? 'Recharger les données de démonstration'
                    : 'Charger des données de démonstration'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setConfirmClearDemo(true)}
                className="inline-flex items-center gap-2 rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                <span>Supprimer les données de démonstration</span>
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Journal d’audit des opérations (100 dernières actions)
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Historique horodaté des créations, modifications, annulations et restaurations.
              </p>
            </div>

            {!auditLogs || auditLogs.length === 0 ? (
              <div className="text-sm text-slate-500">Aucune entrée enregistrée.</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600">
                    <tr>
                      <th className="px-3 py-2">Date & heure</th>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Objet</th>
                      <th className="px-3 py-2">Résumé</th>
                      <th className="px-3 py-2">Motif</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-600 tabular-nums whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString('fr-FR')}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-800">{log.action}</td>
                        <td className="px-3 py-2 text-slate-600">{log.entityType}</td>
                        <td className="px-3 py-2 text-slate-800">{log.summary}</td>
                        <td className="px-3 py-2 text-slate-500">{log.reason || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Dialogues de confirmation */}
      <ConfirmDialog
        open={Boolean(pendingRestoreInfo)}
        title="Confirmer la restauration de sauvegarde"
        description={
          pendingRestoreInfo
            ? `Vous êtes sur le point de restaurer la sauvegarde « ${pendingRestoreInfo.companyName} » datée du ${new Date(
                pendingRestoreInfo.exportedAt
              ).toLocaleString('fr-FR')} (${pendingRestoreInfo.recordCount} enregistrements). Une sauvegarde de sécurité de vos données actuelles sera créée automatiquement avant le remplacement.`
            : ''
        }
        confirmLabel="Restaurer maintenant"
        variant="primary"
        onConfirm={confirmRestore}
        onCancel={() => {
          setPendingRestoreJson(null);
          setPendingRestoreInfo(null);
        }}
      />

      <ConfirmDialog
        open={confirmClearDemo}
        title="Supprimer les données de démonstration ?"
        description="Toutes les écritures marquées comme démonstration seront retirées de la base locale. Vos propres données saisies seront conservées."
        confirmLabel="Supprimer la démo"
        variant="danger"
        onConfirm={handleClearDemo}
        onCancel={() => setConfirmClearDemo(false)}
      />
    </div>
  );
};
