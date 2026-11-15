import React from 'react';
import { DEVELOPER_BRAND } from '../constants/branding';

const HELP_SECTIONS = [
  {
    title: '1. Démarrage & Paramètres de l’entreprise',
    body: 'Renseignez le nom, le logo, l’adresse et les identifiants fiscaux algériens (NIF, NIS, RC, AI) dans Paramètres. Ces informations apparaissent automatiquement sur vos factures, relevés de compte et rapports PDF A4. Vous pouvez basculer entre le Mode simple (usage quotidien épuré) et le Mode avancé (toutes options multi-devises et journaux) depuis la barre supérieure.',
  },
  {
    title: '2. Factures clients & fournisseurs (HT / TVA / TTC)',
    body: 'Les montants sont calculés exactement au centime près. Une facture enregistrée constate une créance ou une dette, mais ne modifie pas encore le solde de votre banque ou de votre caisse. Les statuts (Impayée, Partielle, Payée, En retard) se mettent à jour automatiquement selon les paiements alloués et la date d’échéance.',
  },
  {
    title: '3. Paiements, ventilation multi-factures & avances',
    body: 'Dans Recettes (ou Factures), enregistrez un encaissement ou règlement en espèces, chèque, virement ou carte. Un seul paiement peut être réparti sur plusieurs factures, ou enregistré sans facture comme avance (crédit disponible utilisable ultérieurement).',
  },
  {
    title: '4. Dépenses & règle zéro doublon avec les chèques',
    body: 'Enregistrez vos dépenses avec bénéficiaire, catégorie personnalisable et mode de paiement. Si une dépense est réglée en espèces, par virement ou par carte, elle débite immédiatement la trésorerie. Si elle est payée par chèque, la dépense est liée à un chèque émis et n’entre au grand livre qu’une seule fois lorsque le chèque passe au statut Encaissé.',
  },
  {
    title: '5. Banques, chéquiers automatiques & chèques',
    body: 'Créez plusieurs banques et plusieurs comptes avec leur devise et solde d’ouverture. Dans Chèques émis > Chéquiers, indiquez le premier numéro avec ses zéros initiaux (ex. 0012345) et le nombre de feuillets (ex. 25) : toute la série est créée automatiquement. Chaque numéro est unique par banque et ne peut jamais être réutilisé, même après annulation. Les chèques reçus et émis n’entrent dans la trésorerie réelle qu’à leur date d’encaissement.',
  },
  {
    title: '6. Rapports, Export Excel (.xlsx) & PDF A4',
    body: 'Le module Rapports regroupe 10 synthèses filtrables par dates, client, fournisseur, banque, devise et statut. Chaque rapport s’exporte en fichier Excel (.xlsx) avec zéros initiaux préservés sur les numéros de chèques, et en PDF A4 propre incluant le nom et le logo de votre entreprise, la date d’édition et la pagination.',
  },
  {
    title: '7. Assistant d’importation Excel & modèles',
    body: 'Dans Rapports > Import Excel, téléchargez d’abord un modèle .xlsx prêt à l’emploi pour vos clients, fournisseurs, factures, dépenses ou chèques. L’assistant détecte automatiquement les en-têtes français, permet d’ajuster la correspondance des colonnes, bloque les doublons, signale les erreurs ligne par ligne (avec export des erreurs en Excel) et préserve les zéros initiaux des chèques.',
  },
  {
    title: '8. Sauvegardes, restauration & données de démonstration',
    body: 'Exportez et restaurez à tout moment vos données complètes (logo inclus) au format .json avec vérification d’intégrité et sauvegarde de sécurité automatique avant restauration. Sous Windows (.exe), une sauvegarde automatique est créée à l’ouverture et à la fermeture dans Documents\\GestionFinanciere\\Sauvegardes (30 dernières conservées). Depuis Paramètres > Données démo, vous pouvez charger ou supprimer entièrement les données fictives avant votre utilisation réelle.',
  },
];

export const HelpPage: React.FC = () => {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">
          Guide complet d’utilisation — Gestion Financière
        </h2>
        <p className="text-sm text-slate-600">
          Logiciel de gestion financière 100 % hors-ligne conçu par <strong>{DEVELOPER_BRAND}</strong> pour les entreprises algériennes. Toutes vos données restent strictement sur votre ordinateur, sans connexion Internet ni serveur externe.
        </p>

        <div className="grid grid-cols-1 gap-4 pt-3 md:grid-cols-2">
          {HELP_SECTIONS.map((sec) => (
            <div key={sec.title} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-sm font-semibold text-slate-900">{sec.title}</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{sec.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5 text-xs text-slate-600 space-y-1.5">
        <div className="font-semibold text-slate-800">Règles de sécurité comptable intégrées :</div>
        <ul className="list-disc pl-5 space-y-1">
          <li>Aucune écriture validée n’est supprimée définitivement : utilisez toujours l’annulation avec motif (tracée dans le journal d’audit).</li>
          <li>Les montants sont stockés en entiers (centimes) afin d’éviter toute erreur d’arrondi flottant.</li>
          <li>Les factures ne modifient jamais la trésorerie : seuls les paiements valides et les chèques encaissés alimentent le grand livre.</li>
        </ul>
      </div>
    </div>
  );
};
