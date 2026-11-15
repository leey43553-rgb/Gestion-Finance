import React, { useState } from 'react';
import { Building2, Check, ChevronLeft, ChevronRight, FolderOpen, Landmark, Plus, Trash2, Upload } from 'lucide-react';
import { createId, db, recordAudit } from '../db/database';
import type { BankAccount, CompanySettings, CurrencyConfig } from '../db/types';
import { DEFAULT_CURRENCIES, formatMoney, parseMoneyInputToCentimes } from '../utils/money';
import { loadDemoData } from '../services/demoData';
import { useAppStore } from '../store/useAppStore';

interface OnboardingWizardProps {
  settings: CompanySettings;
}

interface DraftBank {
  id: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  currency: string;
  openingBalanceText: string;
  openingDate: string;
}

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ settings }) => {
  const pushToast = useAppStore((s) => s.pushToast);
  const [step, setStep] = useState(1);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Étape 1 : Entreprise & Logo
  const [companyName, setCompanyName] = useState(settings.companyName || '');
  const [logoDataUrl, setLogoDataUrl] = useState(settings.logoDataUrl || '');
  const [address, setAddress] = useState(settings.address || '');
  const [phone, setPhone] = useState(settings.phone || '');
  const [email, setEmail] = useState(settings.email || '');

  // Étape 2 : Fiscalité & Devises
  const [nif, setNif] = useState(settings.nif || '');
  const [nis, setNis] = useState(settings.nis || '');
  const [rc, setRc] = useState(settings.rc || '');
  const [ai, setAi] = useState(settings.ai || '');
  const [defaultCurrency, setDefaultCurrency] = useState(settings.defaultCurrency || 'DZD');
  const [currencies, setCurrencies] = useState<CurrencyConfig[]>(
    settings.enabledCurrencies?.length ? settings.enabledCurrencies : DEFAULT_CURRENCIES
  );
  const [defaultTvaRate, setDefaultTvaRate] = useState(String(settings.defaultTvaRate ?? 19));
  const [invoicePrefix, setInvoicePrefix] = useState(settings.invoicePrefix || 'FAC-');

  // Étape 3 : Caisse & Comptes bancaires
  const today = new Date().toISOString().slice(0, 10);
  const [cashOpeningText, setCashOpeningText] = useState('0,00');
  const [cashOpeningDate, setCashOpeningDate] = useState(today);
  const [banks, setBanks] = useState<DraftBank[]>([
    {
      id: createId('bank'),
      bankName: '',
      accountName: '',
      accountNumber: '',
      currency: 'DZD',
      openingBalanceText: '0,00',
      openingDate: today,
    },
  ]);

  // Étape 4 : Sauvegardes & Démarrage
  const [backupFolder, setBackupFolder] = useState(settings.backupFolder || '');
  const [startWithDemo, setStartWithDemo] = useState(false);

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 1024 * 1024 * 2) {
      setError('Le logo ne doit pas dépasser 2 Mo.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setLogoDataUrl(reader.result);
        setError('');
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSelectFolder = async () => {
    if (!window.electronAPI?.selectFolder) return;
    const res = await window.electronAPI.selectFolder(backupFolder);
    if (res.ok && res.directory) {
      setBackupFolder(res.directory);
    }
  };

  const handleNext = () => {
    setError('');
    if (step === 1 && !startWithDemo) {
      if (!companyName.trim()) {
        setError('Veuillez saisir le nom de votre entreprise (vous pourrez le modifier plus tard).');
        return;
      }
    }
    if (step === 2) {
      const tva = Number(defaultTvaRate.replace(',', '.'));
      if (!Number.isFinite(tva) || tva < 0 || tva > 100) {
        setError('Le taux de TVA par défaut doit être compris entre 0 et 100 %.');
        return;
      }
    }
    if (step === 3) {
      const cashCentimes = parseMoneyInputToCentimes(cashOpeningText);
      if (Number.isNaN(cashCentimes) || cashCentimes < 0) {
        setError('Le solde initial de caisse doit être un montant valide positif ou nul.');
        return;
      }
      for (const b of banks) {
        const hasAny = b.bankName.trim() || b.accountName.trim() || b.accountNumber.trim();
        if (hasAny && !b.bankName.trim()) {
          setError('Veuillez indiquer le nom de la banque pour chaque compte saisi.');
          return;
        }
        const bal = parseMoneyInputToCentimes(b.openingBalanceText);
        if (Number.isNaN(bal)) {
          setError(`Solde d’ouverture invalide pour la banque « ${b.bankName || 'Sans nom'} ».`);
          return;
        }
      }
    }
    setStep((s) => Math.min(4, s + 1));
  };

  const handleFinish = async () => {
    setError('');
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const tvaVal = Number(defaultTvaRate.replace(',', '.'));
      const cashCentimes = parseMoneyInputToCentimes(cashOpeningText);

      if (!startWithDemo && !companyName.trim()) {
        setError('Le nom de l’entreprise est requis.');
        setStep(1);
        setBusy(false);
        return;
      }

      const validBanks = banks.filter((b) => b.bankName.trim());

      await db.transaction(
        'rw',
        [db.settings, db.bankAccounts, db.ledgerEntries, db.auditLogs],
        async () => {
          await db.settings.put({
            ...settings,
            companyName: companyName.trim(),
            logoDataUrl,
            address: address.trim(),
            phone: phone.trim(),
            email: email.trim(),
            nif: nif.trim(),
            nis: nis.trim(),
            rc: rc.trim(),
            ai: ai.trim(),
            defaultCurrency,
            enabledCurrencies: currencies,
            defaultTvaRate: Number.isFinite(tvaVal) ? tvaVal : 19,
            invoicePrefix: invoicePrefix.trim() || 'FAC-',
            cashOpeningBalanceCentimes: Number.isNaN(cashCentimes) ? 0 : cashCentimes,
            cashOpeningDate,
            backupFolder: backupFolder.trim(),
            onboardingCompleted: true,
            updatedAt: now,
          });

          if (!startWithDemo) {
            if (cashCentimes > 0) {
              await db.ledgerEntries.put({
                id: createId('led'),
                date: cashOpeningDate || today,
                direction: 'entree',
                sourceType: 'solde_ouverture',
                sourceId: 'cash_opening',
                bankAccountId: null,
                label: 'Solde d’ouverture Caisse espèces',
                amountCentimes: cashCentimes,
                currency: defaultCurrency,
                exchangeRate: 1,
                baseDzdAmountCentimes: cashCentimes,
                status: 'valide',
                createdAt: now,
              });
            }

            for (const b of validBanks) {
              const bal = parseMoneyInputToCentimes(b.openingBalanceText);
              const safeBal = Number.isNaN(bal) ? 0 : bal;
              const bankId = createId('bank');
              const account: BankAccount = {
                id: bankId,
                bankName: b.bankName.trim(),
                accountName: b.accountName.trim() || `${b.bankName.trim()} (${b.currency})`,
                accountNumber: b.accountNumber.trim(),
                rib: '',
                currency: b.currency,
                openingBalanceCentimes: safeBal,
                openingDate: b.openingDate || today,
                notes: 'Compte créé lors de la configuration initiale',
                active: true,
                createdAt: now,
                updatedAt: now,
              };
              await db.bankAccounts.put(account);

              if (safeBal !== 0) {
                const curr = currencies.find((c) => c.code === b.currency);
                const rate = curr?.rateToDzd || 1;
                await db.ledgerEntries.put({
                  id: createId('led'),
                  date: b.openingDate || today,
                  direction: safeBal >= 0 ? 'entree' : 'sortie',
                  sourceType: 'solde_ouverture',
                  sourceId: bankId,
                  bankAccountId: bankId,
                  label: `Solde d’ouverture ${account.accountName}`,
                  amountCentimes: Math.abs(safeBal),
                  currency: b.currency,
                  exchangeRate: rate,
                  baseDzdAmountCentimes: Math.round(Math.abs(safeBal) * rate),
                  status: 'valide',
                  createdAt: now,
                });
              }
            }
          }
        }
      );

      if (startWithDemo) {
        await loadDemoData();
      }

      await recordAudit({
        action: 'CREATION',
        entityType: 'configuration_initiale',
        entityId: 'company_settings',
        summary: startWithDemo
          ? 'Configuration initiale terminée avec données de démonstration'
          : `Configuration initiale terminée pour ${companyName.trim()}`,
      });

      pushToast({
        type: 'success',
        title: 'Bienvenue dans Gestion Financière',
        message: 'Votre espace hors-ligne est prêt. Tous les paramètres restent modifiables.',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d’enregistrer la configuration.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-6">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        {/* En-tête assistant */}
        <div className="border-b border-slate-200 bg-[#0F1E36] px-6 py-5 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10">
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold">Configuration initiale — Gestion Financière</h2>
                <p className="text-xs text-slate-300">
                  Étape {step} sur 4 · Fonctionnement 100 % hors-ligne sur votre ordinateur
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4].map((num) => (
                <div
                  key={num}
                  className={`h-2 w-8 rounded-full transition-colors ${
                    num <= step ? 'bg-emerald-400' : 'bg-slate-700'
                  }`}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Corps */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  1. Identité de votre entreprise
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Ces informations apparaîtront sur vos factures, relevés de comptes et rapports PDF.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Nom / Raison sociale *
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Ex : SARL El Wiam Services"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#1D4ED8] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">Téléphone</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0550 00 00 00"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#1D4ED8] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="contact@monentreprise.dz"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#1D4ED8] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700">Adresse</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Rue, Commune, Wilaya"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-[#1D4ED8] focus:outline-none"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-slate-700">
                    Logo de l’entreprise (stocké localement)
                  </label>
                  <div className="mt-1.5 flex items-center gap-4">
                    {logoDataUrl ? (
                      <img
                        src={logoDataUrl}
                        alt="Aperçu du logo"
                        className="h-14 w-14 rounded border border-slate-200 bg-white object-contain p-1"
                      />
                    ) : (
                      <div className="flex h-14 w-14 items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-slate-400">
                        <Building2 className="h-6 w-6" />
                      </div>
                    )}
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                      <Upload className="h-4 w-4" />
                      <span>Choisir une image (PNG / JPG)</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleLogoFile}
                        className="hidden"
                      />
                    </label>
                    {logoDataUrl && (
                      <button
                        type="button"
                        onClick={() => setLogoDataUrl('')}
                        className="text-xs font-medium text-red-600 hover:underline"
                      >
                        Retirer
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  2. Informations fiscales, TVA et devises
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Renseignez vos identifiants fiscaux algériens (facultatifs) et la devise principale.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700">NIF</label>
                  <input
                    type="text"
                    value={nif}
                    onChange={(e) => setNif(e.target.value)}
                    placeholder="Numéro d'identification fiscale"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">NIS</label>
                  <input
                    type="text"
                    value={nis}
                    onChange={(e) => setNis(e.target.value)}
                    placeholder="Numéro d'identification statistique"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">RC (Registre de Commerce)</label>
                  <input
                    type="text"
                    value={rc}
                    onChange={(e) => setRc(e.target.value)}
                    placeholder="Ex : 16/00-1234567B20"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">AI (Article d’imposition)</label>
                  <input
                    type="text"
                    value={ai}
                    onChange={(e) => setAi(e.target.value)}
                    placeholder="Ex : 16241234567"
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Devise par défaut</label>
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
                  <label className="block text-sm font-medium text-slate-700">
                    Préfixe factures clients
                  </label>
                  <input
                    type="text"
                    value={invoicePrefix}
                    onChange={(e) => setInvoicePrefix(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700">Devises activées</label>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {currencies.map((c) => (
                      <label key={c.code} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
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
                        <span>{c.code}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  3. Caisse et comptes bancaires initiaux
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Saisissez votre solde de caisse espèces et vos comptes bancaires existants.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-sm font-semibold text-slate-800">Caisse espèces</div>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600">
                      Solde d’ouverture ({defaultCurrency})
                    </label>
                    <input
                      type="text"
                      value={cashOpeningText}
                      onChange={(e) => setCashOpeningText(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-right tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600">Date d’ouverture</label>
                    <input
                      type="date"
                      value={cashOpeningDate}
                      onChange={(e) => setCashOpeningDate(e.target.value)}
                      className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <Landmark className="h-4 w-4 text-slate-600" />
                    <span>Comptes bancaires</span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setBanks((prev) => [
                        ...prev,
                        {
                          id: createId('bank'),
                          bankName: '',
                          accountName: '',
                          accountNumber: '',
                          currency: defaultCurrency,
                          openingBalanceText: '0,00',
                          openingDate: today,
                        },
                      ])
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Ajouter un compte</span>
                  </button>
                </div>

                {banks.map((b, idx) => (
                  <div key={b.id} className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-500">Compte #{idx + 1}</span>
                      {banks.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setBanks((prev) => prev.filter((item) => item.id !== b.id))}
                          className="text-xs text-red-600 hover:underline inline-flex items-center gap-1"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Supprimer</span>
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div>
                        <label className="block text-xs font-medium text-slate-600">Banque (ex: BNA, CPA)</label>
                        <input
                          type="text"
                          value={b.bankName}
                          onChange={(e) =>
                            setBanks((prev) =>
                              prev.map((item) =>
                                item.id === b.id ? { ...item, bankName: e.target.value } : item
                              )
                            )
                          }
                          placeholder="BNA"
                          className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600">Intitulé du compte</label>
                        <input
                          type="text"
                          value={b.accountName}
                          onChange={(e) =>
                            setBanks((prev) =>
                              prev.map((item) =>
                                item.id === b.id ? { ...item, accountName: e.target.value } : item
                              )
                            )
                          }
                          placeholder="Compte courant"
                          className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600">Devise</label>
                        <select
                          value={b.currency}
                          onChange={(e) =>
                            setBanks((prev) =>
                              prev.map((item) =>
                                item.id === b.id ? { ...item, currency: e.target.value } : item
                              )
                            )
                          }
                          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
                        >
                          {currencies
                            .filter((c) => c.enabled || c.code === defaultCurrency)
                            .map((c) => (
                              <option key={c.code} value={c.code}>
                                {c.code}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-slate-600">Solde d’ouverture</label>
                        <input
                          type="text"
                          value={b.openingBalanceText}
                          onChange={(e) =>
                            setBanks((prev) =>
                              prev.map((item) =>
                                item.id === b.id
                                  ? { ...item, openingBalanceText: e.target.value }
                                  : item
                              )
                            )
                          }
                          className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-right tabular-nums"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  4. Sauvegarde automatique et démarrage
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Vos données restent exclusivement sur votre ordinateur. Aucune donnée n’est envoyée sur Internet.
                </p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                <div className="text-sm font-medium text-slate-800">Dossier de sauvegarde automatique</div>
                {window.electronAPI?.isElectron ? (
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      value={backupFolder || 'Documents\\GestionFinanciere\\Sauvegardes (par défaut)'}
                      readOnly
                      className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700"
                    />
                    <button
                      type="button"
                      onClick={handleSelectFolder}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                    >
                      <FolderOpen className="h-4 w-4" />
                      <span>Choisir un dossier</span>
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-slate-600">
                    En mode navigateur, vous pouvez télécharger une sauvegarde JSON complète à tout moment depuis <strong>Paramètres &gt; Sauvegardes</strong>. Dans la version bureau Windows (<code>.exe</code>), une sauvegarde automatique est écrite à l’ouverture et à la fermeture dans <code>Documents\GestionFinanciere\Sauvegardes</code>.
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={startWithDemo}
                    onChange={(e) => setStartWithDemo(e.target.checked)}
                    className="mt-1"
                  />
                  <div>
                    <div className="text-sm font-medium text-slate-900">
                      Charger des données de démonstration fictives pour explorer le logiciel
                    </div>
                    <div className="mt-0.5 text-xs text-slate-600">
                      Ajoute des clients, fournisseurs, factures, chèques et banques fictifs en Algérie. Vous pourrez les supprimer en un clic depuis <strong>Paramètres</strong>.
                    </div>
                  </div>
                </label>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs text-slate-700 space-y-1">
                <div>
                  <strong>Entreprise :</strong> {companyName || '(Modèle démo si coché)'}
                </div>
                <div>
                  <strong>Devise & TVA :</strong> {defaultCurrency} · TVA {defaultTvaRate} %
                </div>
                <div>
                  <strong>Caisse initiale :</strong>{' '}
                  <span className="tabular-nums">
                    {formatMoney(parseMoneyInputToCentimes(cashOpeningText) || 0, defaultCurrency, currencies)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Pied assistant */}
        <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setStep((s) => s - 1);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                <ChevronLeft className="h-4 w-4" />
                <span>Précédent</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {step < 4 ? (
              <button
                type="button"
                onClick={handleNext}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#0F1E36] px-5 py-2 text-sm font-medium text-white hover:bg-[#1a2f52]"
              >
                <span>Suivant</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={handleFinish}
                className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                <Check className="h-4 w-4" />
                <span>{busy ? 'Initialisation...' : 'Terminer et ouvrir Gestion Financière'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
