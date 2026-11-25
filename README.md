# CRM mobile d’équipe

Site web statique autonome, indépendant de MesArchives et du complément Outlook, destiné aux smartphones, tablettes et ordinateurs. Le dépôt GitHub dédié est prévu sous `DELLASIEGAPS/responds-crm`. Une fois GitHub Pages activé, l’adresse publique sera `https://dellasiegaps.github.io/responds-crm/`. Le sous-domaine `crm.dsdata.biz` et le lien depuis `www.dsdata.biz` nécessiteront ensuite une configuration DNS et une validation par l’administrateur du site. L’authentification, les données partagées et les justificatifs sont conçus pour Supabase.

## État du prototype

- Interface française avec tableau de bord, contacts, journal d’activités et guide d’intégration basé sur la note fournie.
- Comptes par e-mail/mot de passe, sur invitation seulement ; aucun bouton d’inscription libre.
- Contacts modifiables par leur créateur ou un manager, recherche et filtres, échéances, comptes-rendus et justificatifs enregistrés dans Supabase lorsque les clés publiques sont configurées.
- Le guide compact ne remplace pas la note officielle complète. La reconnaissance de lecture est versionnée dans la base et visible par le membre concerné ; ce n’est ni une signature juridique ni un dispositif disciplinaire.
- Aucun exemple de contact réel n’est inclus.

## Configuration Supabase

1. Créer un projet Supabase autorisé par l’entreprise et vérifier la région, les règles de conservation, l’accord de traitement, les sauvegardes et les administrateurs.
2. Exécuter `supabase/schema.sql` dans le SQL Editor du projet.
3. Créer une équipe et attribuer les comptes invités aux membres via le tableau de bord Supabase ou un canal d’administration protégé. Ne pas activer l’inscription publique.
4. Désactiver « Enable sign ups » dans Authentication. Créer les comptes et envoyer les invitations/réinitialisations via Supabase Auth.
5. Régler les URL de redirection Auth sur `https://crm.dsdata.biz/**` et les URL de production/prévisualisation explicitement autorisées.
6. Renseigner `supabaseUrl` et la clé `anon`/publishable publique dans `config.js`. Cette clé n’est pas un secret ; les politiques RLS du schéma sont la protection d’accès. **Ne jamais utiliser `service_role` dans le navigateur ou dans Git.**
7. Dans les paramètres du dépôt GitHub indépendant, activer GitHub Pages avec la source **GitHub Actions**. Le workflow `.github/workflows/pages.yml` publie le site sur `https://dellasiegaps.github.io/responds-crm/`. Pour utiliser `crm.dsdata.biz`, configurer ultérieurement le domaine personnalisé dans Pages et son DNS, puis faire ajouter un lien « Espace équipe » dans le menu de `www.dsdata.biz`. Aucun DNS ni site d’entreprise n’a été modifié. Tester les invitations, RLS entre deux équipes, téléversements, export, suppression de compte et sauvegarde avant d’importer des données réelles.

Le compte de démonstration n’est pas préconfiguré. Tant que Supabase n’est pas configuré, la connexion affiche un message explicite ; aucun contact ni suivi d’équipe n’est enregistré dans le navigateur.

## Fichiers

- `index.html`, `styles.css`, `app.js` : interface adaptative et opérations CRM.
- `config.js` : URL du projet et clé publique uniquement.
- `supabase/schema.sql` : tables, politiques RLS et bucket privé de justificatifs.
- `manifest.webmanifest`, `sw.js` : installation mobile et cache limité aux ressources de l’interface ; les appels authentifiés et données privées ne sont jamais mis en cache hors ligne.
