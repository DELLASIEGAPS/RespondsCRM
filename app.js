const config = window.CRM_CONFIG || {};
const POLICY_VERSION = "2026-11-v1";
const PROOF_BUCKET = "crm-proofs";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set([
  "application/pdf", "image/jpeg", "image/png", "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);
const KIND_LABELS = {
  call: "Appel", meeting: "Rendez-vous", email: "E-mail", follow_up: "Relance",
  admin: "Démarche administrative", field: "Intervention terrain",
  expense: "Dépense", other: "Autre action"
};
const STATUS_LABELS = {
  new: "À contacter", contacted: "Contacté", qualified: "Qualifié",
  customer: "Client actif", paused: "En pause"
};
const CONTACT_KIND_LABELS = { prospect: "Prospect", client: "Client", partner: "Partenaire" };

const authScreen = document.getElementById("auth-screen");
const appShell = document.getElementById("app-shell");
const authMessage = document.getElementById("auth-message");
const toast = document.getElementById("toast");
const state = { client: null, user: null, teamId: null, teams: [], contacts: [], activities: [], toastTimer: null };

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle("toast-error", isError);
  toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.remove("visible"), 4200);
}

function setFormMessage(id, message) {
  document.getElementById(id).textContent = message;
}

function showAuth(message = "") {
  state.user = null;
  state.teamId = null;
  state.teams = [];
  state.contacts = [];
  state.activities = [];
  appShell.hidden = true;
  authScreen.hidden = false;
  authMessage.textContent = message;
  document.getElementById("auth-sign-out").hidden = !state.client;
}

function safeText(value) {
  return String(value ?? "").trim();
}

function initials(firstName, lastName) {
  return (safeText(firstName).slice(0, 1) + safeText(lastName).slice(0, 1)).toLocaleUpperCase("fr-FR") || "DS";
}

function formatDate(value, options = { day: "2-digit", month: "short", year: "numeric" }) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("fr-FR", options).format(date);
}

function escapePathPart(value) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100) || "document";
}

async function loadTeamMemberships() {
  const { data: memberships, error } = await state.client
    .from("team_members")
    .select("team_id, role")
    .eq("user_id", state.user.id);
  if (error) throw error;
  if (!memberships?.length) throw new Error("Aucun espace d’équipe ne vous est attribué. Demandez à l’administrateur de vous inviter.");

  const { data: teams, error: teamError } = await state.client
    .from("teams")
    .select("id, name")
    .in("id", memberships.map((membership) => membership.team_id));
  if (teamError) throw teamError;
  state.teams = (teams || []).map((team) => ({
    ...team,
    role: memberships.find((membership) => membership.team_id === team.id)?.role || "member"
  }));
  state.teamId = state.teams[0]?.id || null;
  if (!state.teamId) throw new Error("Aucune équipe accessible.");

  const picker = document.getElementById("team-picker");
  const wrapper = document.getElementById("team-picker-wrap");
  picker.replaceChildren();
  for (const team of state.teams) {
    const option = document.createElement("option");
    option.value = team.id;
    option.textContent = team.name;
    picker.append(option);
  }
  wrapper.hidden = state.teams.length < 2;
  picker.value = state.teamId;
}

async function loadWorkspace() {
  const [contactsResult, activitiesResult, acknowledgementResult] = await Promise.all([
    state.client.from("contacts").select("*").eq("team_id", state.teamId).order("updated_at", { ascending: false }).limit(500),
    state.client.from("activities").select("*").eq("team_id", state.teamId).order("occurred_at", { ascending: false }).limit(500),
    state.client.from("onboarding_acknowledgements").select("id, acknowledged_at")
      .eq("team_id", state.teamId).eq("user_id", state.user.id).eq("policy_version", POLICY_VERSION).maybeSingle()
  ]);
  for (const result of [contactsResult, activitiesResult, acknowledgementResult]) {
    if (result.error) throw result.error;
  }
  state.contacts = contactsResult.data || [];
  state.activities = activitiesResult.data || [];
  renderWorkspace();
  renderAcknowledgement(acknowledgementResult.data);
}

function renderWorkspace() {
  document.getElementById("nav-contact-count").textContent = String(state.contacts.length);
  document.getElementById("stat-contacts").textContent = String(state.contacts.length);
  document.getElementById("stat-activities").textContent = String(state.activities.length);
  document.getElementById("first-name").textContent = state.user.user_metadata?.first_name || state.user.email?.split("@")[0] || "collaborateur";
  document.getElementById("user-email").textContent = state.user.email || "";
  document.getElementById("user-avatar").textContent = initials(state.user.user_metadata?.first_name || "D", state.user.user_metadata?.last_name || "S");
  document.getElementById("today-label").textContent = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date()).toLocaleUpperCase("fr-FR");
  renderRecentContacts();
  renderContactTable();
  renderActivities();
  renderUpcoming();
  updateDueCount();
}

function renderRecentContacts() {
  const root = document.getElementById("recent-contacts");
  root.replaceChildren();
  for (const contact of state.contacts.slice(0, 5)) root.append(makeContactRow(contact));
  if (!state.contacts.length) root.append(makeEmptyHint("Aucun contact pour le moment. Ajoutez votre premier prospect."));
}

function makeContactRow(contact) {
  const row = document.createElement("div");
  row.className = "contact-row";
  const icon = document.createElement("span");
  icon.className = "contact-initials";
  icon.textContent = initials(contact.first_name, contact.last_name);
  const main = document.createElement("div");
  main.className = "contact-main";
  const name = document.createElement("strong");
  name.textContent = `${contact.first_name} ${contact.last_name}`;
  const company = document.createElement("small");
  company.textContent = contact.company;
  main.append(name, company);
  const badge = document.createElement("span");
  badge.className = `badge ${contact.kind}`;
  badge.textContent = CONTACT_KIND_LABELS[contact.kind] || "Contact";
  row.append(icon, main, badge);
  return row;
}

function makeEmptyHint(text) {
  const element = document.createElement("p");
  element.className = "empty-hint";
  element.textContent = text;
  return element;
}

function renderContactTable() {
  const tbody = document.getElementById("contact-rows");
  const empty = document.getElementById("contact-empty");
  const query = safeText(document.getElementById("contact-search").value).toLocaleLowerCase("fr-FR");
  const filter = document.getElementById("contact-filter").value;
  const filtered = state.contacts.filter((contact) => {
    const matchesText = !query || [
      contact.first_name, contact.last_name, contact.company, contact.email, contact.phone, contact.job_title
    ].some((value) => safeText(value).toLocaleLowerCase("fr-FR").includes(query));
    return matchesText && (filter === "all" || contact.kind === filter);
  });
  tbody.replaceChildren();
  empty.hidden = filtered.length !== 0;
  for (const contact of filtered) {
    const row = document.createElement("tr");
    const personCell = document.createElement("td");
    const person = document.createElement("div");
    person.className = "table-person";
    const avatar = document.createElement("span");
    avatar.className = "contact-initials";
    avatar.textContent = initials(contact.first_name, contact.last_name);
    const identity = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = `${contact.first_name} ${contact.last_name}`;
    const email = document.createElement("small");
    email.className = "cell-subtitle";
    email.textContent = contact.email || contact.job_title || "—";
    identity.append(name, email);
    person.append(avatar, identity);
    personCell.append(person);
    const companyCell = document.createElement("td");
    companyCell.textContent = contact.company;
    const statusCell = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = `badge ${contact.status}`;
    badge.textContent = STATUS_LABELS[contact.status] || contact.status;
    statusCell.append(badge);
    const ownerCell = document.createElement("td");
    ownerCell.textContent = contact.created_by === state.user.id ? "Vous" : "Équipe";
    const nextCell = document.createElement("td");
    nextCell.textContent = contact.next_step ? `${contact.next_step}${contact.next_due_at ? ` · ${formatDate(contact.next_due_at)}` : ""}` : "—";
    const actionCell = document.createElement("td");
    personCell.dataset.label = "Contact";
    companyCell.dataset.label = "Entreprise";
    statusCell.dataset.label = "Statut";
    ownerCell.dataset.label = "Responsable";
    nextCell.dataset.label = "Prochaine étape";
    actionCell.dataset.label = "Action";
    const actions = document.createElement("div");
    actions.className = "row-actions";
    const role = state.teams.find((team) => team.id === state.teamId)?.role;
    if (contact.created_by === state.user.id || role === "manager" || role === "admin") {
      const edit = document.createElement("button");
      edit.className = "row-action";
      edit.type = "button";
      edit.textContent = "Modifier";
      edit.addEventListener("click", () => openContactDialog(contact));
      actions.append(edit);
    }
    const logActivity = document.createElement("button");
    logActivity.className = "row-action";
    logActivity.type = "button";
    logActivity.textContent = "Consigner une action";
    logActivity.addEventListener("click", () => openActivityDialog(contact.id));
    actions.append(logActivity);
    actionCell.append(actions);
    row.append(personCell, companyCell, statusCell, ownerCell, nextCell, actionCell);
    tbody.append(row);
  }
}

function activityContactName(activity) {
  const contact = state.contacts.find((entry) => entry.id === activity.contact_id);
  return contact ? `${contact.first_name} ${contact.last_name} · ${contact.company}` : "Activité d’équipe";
}

function renderActivities() {
  const feed = document.getElementById("activity-feed");
  feed.replaceChildren();
  for (const activity of state.activities) {
    const card = document.createElement("article");
    card.className = "panel feed-card";
    const marker = document.createElement("span");
    marker.className = "activity-marker";
    const content = document.createElement("div");
    const title = document.createElement("h3");
    title.textContent = activity.title;
    const summary = document.createElement("p");
    summary.textContent = activity.summary;
    const meta = document.createElement("div");
    meta.className = "feed-meta";
    const kind = document.createElement("span");
    kind.textContent = KIND_LABELS[activity.kind] || "Action";
    const contact = document.createElement("span");
    contact.textContent = activityContactName(activity);
    const date = document.createElement("time");
    date.dateTime = activity.occurred_at;
    date.textContent = formatDate(activity.occurred_at, { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
    meta.append(kind, contact, date);
    content.append(title, summary, meta);
    if (activity.due_at) {
      const due = document.createElement("div");
      due.className = "feed-meta";
      due.textContent = `Échéance : ${formatDate(activity.due_at)}`;
      content.append(due);
    }
    if (activity.proof_path) {
      const proof = document.createElement("button");
      proof.type = "button";
      proof.className = "row-action proof-link";
      proof.textContent = "Ouvrir le justificatif";
      proof.addEventListener("click", () => openProof(activity.proof_path));
      content.append(proof);
    }
    card.append(marker, content);
    feed.append(card);
  }
  if (!state.activities.length) feed.append(makeEmptyHint("Aucune activité enregistrée. Consignez un appel, une relance ou une autre action."));
}

function renderUpcoming() {
  const root = document.getElementById("upcoming-activities");
  root.replaceChildren();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 7);
  const dueItems = state.activities.filter((item) => item.due_at && new Date(`${item.due_at}T00:00:00`) <= horizon)
    .sort((a, b) => a.due_at.localeCompare(b.due_at)).slice(0, 5);
  for (const activity of dueItems) {
    const row = document.createElement("div");
    row.className = "activity-row";
    const marker = document.createElement("span");
    marker.className = "activity-marker";
    const content = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = activity.title;
    const detail = document.createElement("p");
    detail.textContent = `${activityContactName(activity)} · ${formatDate(activity.due_at)}`;
    content.append(title, detail);
    row.append(marker, content);
    root.append(row);
  }
  if (!dueItems.length) root.append(makeEmptyHint("Aucune échéance enregistrée dans les 7 prochains jours."));
}

function updateDueCount() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 7);
  const count = state.activities.filter((item) => item.due_at && new Date(`${item.due_at}T00:00:00`) >= today && new Date(`${item.due_at}T00:00:00`) <= horizon).length;
  document.getElementById("stat-due").textContent = String(count);
}

function renderAcknowledgement(acknowledgement) {
  const checkbox = document.getElementById("ack-checkbox");
  const button = document.getElementById("acknowledge");
  const status = document.getElementById("ack-status");
  if (acknowledgement) {
    checkbox.checked = true;
    checkbox.disabled = true;
    button.disabled = true;
    button.textContent = "Lecture confirmée";
    status.textContent = `Confirmée le ${formatDate(acknowledgement.acknowledged_at)}.`;
  } else {
    checkbox.checked = false;
    checkbox.disabled = false;
    button.disabled = true;
    button.textContent = "Confirmer ma lecture";
    status.textContent = "";
  }
}

async function refreshWorkspace() {
  try {
    await loadWorkspace();
  } catch (error) {
    showToast(`Impossible de charger l’espace d’équipe : ${error.message}`, true);
  }
}

async function activateSession(session) {
  if (!session) {
    showAuth();
    return;
  }
  if (state.user?.id === session.user.id && !appShell.hidden) return;
  state.user = session.user;
  try {
    await loadTeamMemberships();
    authScreen.hidden = true;
    appShell.hidden = false;
    await loadWorkspace();
  } catch (error) {
    showAuth(error.message || "Impossible de charger votre espace.");
  }
}

function switchView(name) {
  for (const view of document.querySelectorAll(".view")) view.hidden = view.id !== `view-${name}`;
  for (const button of document.querySelectorAll(".nav-link[data-view]")) {
    const active = button.dataset.view === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  const titles = { dashboard: "Vue d’ensemble", contacts: "Contacts", activities: "Activités", onboarding: "Guide d’équipe" };
  document.getElementById("page-title").textContent = titles[name] || titles.dashboard;
}

function closeDialogs() {
  for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
}

function resetForm(formId, errorId) {
  document.getElementById(formId).reset();
  setFormMessage(errorId, "");
}

function openContactDialog(contact = null) {
  resetForm("contact-form", "contact-form-error");
  const dialog = document.getElementById("contact-dialog");
  dialog.dataset.contactId = contact?.id || "";
  dialog.querySelector(".dialog-heading .eyebrow").textContent = contact ? "DOSSIER CONTACT" : "NOUVEAU DOSSIER";
  dialog.querySelector(".dialog-heading h2").textContent = contact ? "Modifier un contact" : "Ajouter un contact";
  dialog.querySelector('[type="submit"]').textContent = contact ? "Enregistrer les modifications" : "Enregistrer le contact";
  if (contact) {
    for (const field of ["first_name", "last_name", "company", "job_title", "email", "phone", "kind", "status", "next_step", "next_due_at", "notes"]) {
      document.querySelector(`#contact-form [name="${field}"]`).value = contact[field] || "";
    }
  }
  dialog.showModal();
}

function openActivityDialog(contactId = "") {
  const select = document.getElementById("activity-contact");
  select.replaceChildren();
  const none = document.createElement("option");
  none.value = "";
  none.textContent = "Aucun contact associé";
  select.append(none);
  for (const contact of state.contacts) {
    const option = document.createElement("option");
    option.value = contact.id;
    option.textContent = `${contact.first_name} ${contact.last_name} · ${contact.company}`;
    select.append(option);
  }
  select.value = contactId;
  const occurred = document.querySelector('#activity-form [name="occurred_at"]');
  occurred.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  resetForm("activity-form", "activity-form-error");
  occurred.value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  select.value = contactId;
  document.getElementById("activity-dialog").showModal();
}

async function saveContact(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  setFormMessage("contact-form-error", "");
  const values = Object.fromEntries(new FormData(form).entries());
  const record = {
    first_name: safeText(values.first_name), last_name: safeText(values.last_name),
    company: safeText(values.company), job_title: safeText(values.job_title),
    email: safeText(values.email), phone: safeText(values.phone),
    kind: values.kind, status: values.status,
    next_step: safeText(values.next_step), next_due_at: values.next_due_at || null,
    notes: safeText(values.notes)
  };
  try {
    const contactId = document.getElementById("contact-dialog").dataset.contactId;
    if (contactId) {
      const { data, error } = await state.client.from("contacts").update(record)
        .eq("id", contactId).eq("team_id", state.teamId).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Contact introuvable ou modification non autorisée.");
    } else {
      const { error } = await state.client.from("contacts").insert({
        ...record, team_id: state.teamId, created_by: state.user.id
      });
      if (error) throw error;
    }
    document.getElementById("contact-dialog").close();
    delete document.getElementById("contact-dialog").dataset.contactId;
    resetForm("contact-form", "contact-form-error");
    showToast(contactId ? "Contact mis à jour." : "Contact enregistré pour l’équipe.");
    await refreshWorkspace();
  } catch (error) {
    setFormMessage("contact-form-error", `Enregistrement impossible : ${error.message}`);
  } finally {
    submit.disabled = false;
  }
}

async function saveActivity(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const file = form.elements.proof.files[0] || null;
  submit.disabled = true;
  setFormMessage("activity-form-error", "");
  const values = Object.fromEntries(new FormData(form).entries());
  if (file && (file.size > MAX_FILE_BYTES || !ALLOWED_FILE_TYPES.has(file.type))) {
    setFormMessage("activity-form-error", "Fichier refusé : choisissez un PDF, une image ou un document Office de 10 Mo maximum.");
    submit.disabled = false;
    return;
  }
  let uploadedPath = null;
  try {
    if (file) {
      uploadedPath = `${state.teamId}/${state.user.id}/${crypto.randomUUID()}-${escapePathPart(file.name)}`;
      const { error: uploadError } = await state.client.storage.from(PROOF_BUCKET)
        .upload(uploadedPath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;
    }
    const record = {
      team_id: state.teamId, created_by: state.user.id,
      contact_id: values.contact_id || null, kind: values.kind,
      title: safeText(values.title), summary: safeText(values.summary),
      occurred_at: new Date(values.occurred_at).toISOString(),
      due_at: values.due_at || null, proof_path: uploadedPath
    };
    const { error } = await state.client.from("activities").insert(record);
    if (error) throw error;
    document.getElementById("activity-dialog").close();
    resetForm("activity-form", "activity-form-error");
    showToast("Activité enregistrée dans le journal d’équipe.");
    await refreshWorkspace();
  } catch (error) {
    if (uploadedPath) {
      const { error: cleanupError } = await state.client.storage.from(PROOF_BUCKET).remove([uploadedPath]);
      if (cleanupError) console.error("Nettoyage du justificatif impossible.", cleanupError);
    }
    setFormMessage("activity-form-error", `Enregistrement impossible : ${error.message}`);
  } finally {
    submit.disabled = false;
  }
}

async function openProof(path) {
  const { data, error } = await state.client.storage.from(PROOF_BUCKET).createSignedUrl(path, 60);
  if (error) {
    showToast(`Impossible d’ouvrir le justificatif : ${error.message}`, true);
    return;
  }
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

async function acknowledgePolicy() {
  const button = document.getElementById("acknowledge");
  button.disabled = true;
  const { data, error } = await state.client.from("onboarding_acknowledgements")
    .insert({ team_id: state.teamId, user_id: state.user.id, policy_version: POLICY_VERSION })
    .select("id, acknowledged_at").single();
  if (error) {
    button.disabled = !document.getElementById("ack-checkbox").checked;
    showToast(`Confirmation non enregistrée : ${error.message}`, true);
    return;
  }
  renderAcknowledgement(data);
  showToast("Votre lecture a été enregistrée.");
}

function bindInterface() {
  document.getElementById("auth-sign-out").addEventListener("click", async () => {
    if (!state.client) return;
    const { error } = await state.client.auth.signOut();
    showAuth(error ? `Déconnexion impossible : ${error.message}` : "Vous êtes déconnecté.");
  });
  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    authMessage.textContent = "";
    const values = new FormData(form);
    const { data, error } = await state.client.auth.signInWithPassword({
      email: safeText(values.get("email")), password: String(values.get("password") || "")
    });
    if (error) authMessage.textContent = `Connexion impossible : ${error.message}`;
    else await activateSession(data.session);
    button.disabled = false;
  });
  document.getElementById("sign-out").addEventListener("click", async () => {
    const { error } = await state.client.auth.signOut();
    if (error) showToast(`Déconnexion impossible : ${error.message}`, true);
    else showAuth("Vous êtes déconnecté.");
  });
  document.getElementById("team-picker").addEventListener("change", async (event) => {
    state.teamId = event.currentTarget.value;
    await refreshWorkspace();
  });
  document.querySelectorAll(".nav-link[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  document.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.go)));
  document.getElementById("contact-search").addEventListener("input", renderContactTable);
  document.getElementById("contact-filter").addEventListener("change", renderContactTable);
  document.getElementById("add-contact").addEventListener("click", () => openContactDialog());
  document.querySelectorAll("[data-add-contact]").forEach((button) => button.addEventListener("click", () => document.getElementById("add-contact").click()));
  document.getElementById("add-activity").addEventListener("click", () => openActivityDialog());
  document.getElementById("contact-form").addEventListener("submit", saveContact);
  document.getElementById("activity-form").addEventListener("submit", saveActivity);
  document.getElementById("ack-checkbox").addEventListener("change", (event) => {
    document.getElementById("acknowledge").disabled = !event.currentTarget.checked;
  });
  document.getElementById("acknowledge").addEventListener("click", acknowledgePolicy);
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", closeDialogs));
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  }
  document.getElementById("today-label").textContent = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date()).toLocaleUpperCase("fr-FR");
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("./sw.js").catch((error) => console.error("Installation PWA impossible.", error));
  }
}

async function initialize() {
  bindInterface();
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    authMessage.textContent = "Configuration Supabase absente. Le site est prêt visuellement ; demandez à l’administrateur de configurer crm/config.js.";
    document.querySelector("#login-form button[type=submit]").disabled = true;
    return;
  }
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    state.client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true }
    });
    state.client.auth.onAuthStateChange((_event, session) => {
      if (!session) showAuth();
      else if (!state.user || state.user.id !== session.user.id) {
        queueMicrotask(() => activateSession(session));
      }
    });
    const { data, error } = await state.client.auth.getSession();
    if (error) throw error;
    if (data.session) await activateSession(data.session);
  } catch (error) {
    authMessage.textContent = `Initialisation impossible : ${error.message}`;
  }
}

initialize();
