import { useEffect, useMemo, useRef, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  activateLicense,
  changePassword,
  createUser,
  deleteUser,
  exportWorkbook,
  exportMasterWorkbook,
  getConfig,
  getCurrentUser,
  getLicense,
  getSettings,
  getUsers,
  getWorkspace,
  importWorkbook,
  login,
  register,
  refineAchievement,
  resetUserPassword,
  saveLogo,
  saveSettings,
  saveWorkspace,
  setAuthToken,
  updateUserRole,
  updateUserActive,
  deleteLogo
} from "../api/client.js";
import {
  cleanKpi,
  cleanMultiline,
  cleanSingleLine,
  compareQuartersDescending,
  formatScore,
  quarterLabel,
  STORAGE_KEY,
  summarizeKpis,
  weightedKpiScore
} from "../domain/kpi.js";
import {
  selectActiveQuarter,
  selectArchivedMasterYears,
  selectArchivedQuarters,
  selectMasterYears,
  selectProfile,
  selectSelectedMaster,
  selectWorkspace
} from "../store/selectors.js";
import { uiActions } from "../store/uiSlice.js";
import { workspaceActions } from "../store/workspaceSlice.js";
import { confirmAction } from "../ui/confirm.js";

export function App() {
  const dispatch = useDispatch();
  const workspace = useSelector(selectWorkspace);
  const saveTimer = useRef();
  const hydrated = useRef(false);
  const [authState, setAuthState] = useState({ checked: false, user: null });
  const [license, setLicense] = useState(null);
  const [settings, setSettings] = useState({ name: "KPI Appraisal Assistant", logoMode: "default" });

  useEffect(() => {
    let cancelled = false;
    async function hydrateWorkspace(nextLicense) {
      try {
        const response = await getWorkspace();
        if (!cancelled) {
          dispatch(workspaceActions.replaceWorkspace(response.state));
          dispatch(uiActions.setSaveStatus("Loaded from MongoDB"));
        }
      } catch (error) {
        if (error.status === 404) {
          if (nextLicense?.active) {
            await saveWorkspace(workspace);
            if (!cancelled) dispatch(uiActions.setSaveStatus("Migrated to MongoDB"));
          } else if (!cancelled) {
            dispatch(uiActions.setSaveStatus("Read-only until licence is active"));
          }
        } else if (error.status === 402) {
          if (!cancelled) setLicense(error.license || { active: false, status: "inactive" });
        } else if (!cancelled) {
          dispatch(uiActions.setSaveStatus("MongoDB unavailable - using local cache"));
          dispatch(uiActions.showToast({ message: error.message, error: true }));
        }
      } finally {
        hydrated.current = true;
      }
    }
    async function boot() {
      try {
        const config = await getConfig();
        if (!cancelled) dispatch(uiActions.setAiConfig(config));
      } catch {
        if (!cancelled) {
          dispatch(uiActions.setAiConfig({ aiConfigured: false, proxyConfigured: false, proxyError: "" }));
        }
      }

      try {
        const { user } = await getCurrentUser();
        if (cancelled) return;
        setAuthState({ checked: true, user });
        const [nextLicense, nextSettings] = await Promise.all([getLicense(), getSettings()]);
        if (cancelled) return;
        setLicense(nextLicense);
        setSettings(nextSettings || { name: "KPI Appraisal Assistant", logoMode: "default" });
        await hydrateWorkspace(nextLicense);
      } catch (error) {
        if (!cancelled) setAuthState({ checked: true, user: null });
      }
    }
    boot();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!authState.user || !license?.active) {
      if (authState.user && hydrated.current) dispatch(uiActions.setSaveStatus("Read-only until licence is active"));
      return undefined;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    if (!hydrated.current) return;
    clearTimeout(saveTimer.current);
    dispatch(uiActions.setSaveStatus("Saving to MongoDB..."));
    saveTimer.current = setTimeout(() => {
      saveWorkspace(workspace)
        .then(() => dispatch(uiActions.setSaveStatus("Saved to MongoDB")))
        .catch(() => dispatch(uiActions.setSaveStatus("MongoDB save failed - cached locally")));
    }, 600);
    return () => clearTimeout(saveTimer.current);
  }, [workspace, dispatch, authState.user, license?.active]);

  async function handleAuth(action, payload) {
    if (action === "register") return register(payload);
    const data = await login(payload);
    setAuthState({ checked: true, user: data.user });
    const [nextLicense, nextSettings] = await Promise.all([getLicense(), getSettings()]);
    setLicense(nextLicense);
    setSettings(nextSettings || { name: "KPI Appraisal Assistant", logoMode: "default" });
    hydrated.current = false;
    const response = await getWorkspace().catch(async (error) => {
      if (error.status !== 404) throw error;
      if (nextLicense.active) await saveWorkspace(workspace);
      return { state: workspace };
    });
    dispatch(workspaceActions.replaceWorkspace(response.state));
    hydrated.current = true;
  }

  function logout() {
    setAuthToken("");
    setAuthState({ checked: true, user: null });
    setLicense(null);
    hydrated.current = false;
  }

  async function handleActivateLicense(licenseKey) {
    const nextLicense = await activateLicense(licenseKey);
    setLicense(nextLicense);
    dispatch(uiActions.showToast({ message: "Licence activated successfully." }));
  }

  function handleSettingsSaved(nextSettings) {
    setSettings(nextSettings || settings);
  }

  if (!authState.checked) return <LoadingScreen label="Checking session" />;
  if (!authState.user) return <AuthScreen onSubmit={handleAuth} />;

  return (
    <div className="app-shell">
      <Sidebar user={authState.user} settings={settings} />
      <main className="main">
        <Header user={authState.user} license={license} settings={settings} onLogout={logout} />
        <MainView
          user={authState.user}
          license={license}
          settings={settings}
          onActivateLicense={handleActivateLicense}
          onSettingsSaved={handleSettingsSaved}
        />
      </main>
      <input id="file-input" type="file" accept=".xlsx,.csv" hidden />
      <ToastRegion />
      <Dialogs />
    </div>
  );
}

function LoadingScreen({ label }) {
  return <main className="auth-page"><section className="auth-card"><span className="brand-mark">K</span><h1>{label}</h1><p>Please wait while the workspace is prepared.</p></section></main>;
}

function AuthScreen({ onSubmit }) {
  const [mode, setMode] = useState("login");
  const emptyRegister = { firstName: "", lastName: "", username: "", password: "", confirmPassword: "" };
  const [form, setForm] = useState({ ...emptyRegister });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (field, value) => setForm({ ...form, [field]: value });
  const registerMismatch = mode === "register" && form.confirmPassword && form.password !== form.confirmPassword;
  async function submit(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (registerMismatch || (mode === "register" && form.password !== form.confirmPassword)) {
      return setError("Passwords do not match.");
    }
    setLoading(true);
    try {
      const result = await onSubmit(mode, form);
      if (mode === "register") {
        setSuccess(result?.message || "Your account has been created successfully. Proceed to login page to login.");
        setForm({ ...emptyRegister });
      }
    } catch (nextError) {
      setError(nextError.message || "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <span className="brand-mark">K</span>
        <p className="eyebrow">SECURE WORKSPACE</p>
        <h1>{mode === "login" ? "Sign in" : "Create account"}</h1>
        {success && (
          <div className="success-panel" role="status">
            {success}{" "}
            <button type="button" onClick={() => { setMode("login"); setSuccess(""); setForm({ ...emptyRegister }); }}>Go to login page</button>
          </div>
        )}
        {mode === "register" && (
          <div className="auth-grid">
            <label>First name<input value={form.firstName} onChange={(event) => set("firstName", event.target.value)} /></label>
            <label>Last name<input value={form.lastName} onChange={(event) => set("lastName", event.target.value)} /></label>
          </div>
        )}
        <label>Username<input value={form.username} autoComplete="username" onChange={(event) => set("username", event.target.value)} /></label>
        <label>Password<input type="password" value={form.password} autoComplete={mode === "login" ? "current-password" : "new-password"} onChange={(event) => set("password", event.target.value)} /></label>
        {mode === "register" && (
          <>
            <PasswordRules password={form.password} />
            <label>Confirm password<input type="password" value={form.confirmPassword} autoComplete="new-password" onChange={(event) => set("confirmPassword", event.target.value)} /></label>
            <PasswordMatchMessage show={registerMismatch} />
          </>
        )}
        {error && <div className="inline-error" role="alert">{error}</div>}
        <button className="button primary" disabled={loading}>{loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}</button>
        <button className="button ghost" type="button" onClick={() => { setError(""); setSuccess(""); setForm(mode === "login" ? { ...emptyRegister } : { ...emptyRegister }); setMode(mode === "login" ? "register" : "login"); }}>
          {mode === "login" ? "Create an editor account" : "Use existing account"}
        </button>
      </form>
    </main>
  );
}

function PasswordMatchMessage({ show }) {
  return show ? <span className="password-mismatch" role="alert">Passwords do not match.</span> : null;
}

function PasswordRules({ password }) {
  const checks = [
    ["8-50 characters", password.length >= 8 && password.length <= 50],
    ["At least one capital letter", /[A-Z]/.test(password)],
    ["At least one small letter", /[a-z]/.test(password)]
  ];
  return (
    <span className="password-rules">
      {checks.map(([label, ok]) => <span key={label} className={ok ? "valid" : ""}>{ok ? "✓" : "•"} {label}</span>)}
    </span>
  );
}

function Sidebar({ user, settings }) {
  const dispatch = useDispatch();
  const saveStatus = useSelector((state) => state.ui.saveStatus);
  const view = useSelector((state) => state.ui.view);
  const logo = settings?.logoData;
  return (
    <aside className="sidebar">
      <a className="brand" href="#" aria-label="KPI Assistant home" onClick={(event) => event.preventDefault()}>
        {logo ? <img className="brand-logo" src={logo} alt="" /> : <span className="brand-mark">K</span>}
        <span>{settings?.name || "KPI Assistant"}</span>
      </a>
      <nav className="nav-list" aria-label="Primary navigation">
        <button className={`nav-item ${view === "home" ? "active" : ""}`} onClick={() => showHome(dispatch)}>
          <span className="nav-icon">H</span> Quarterly KPIs
        </button>
        <button className={`nav-item ${view === "master" ? "active" : ""}`} onClick={() => showMaster(dispatch)}>
          <span className="nav-icon">M</span> Master KPIs
        </button>
        <button className={`nav-item ${view === "archived" ? "active" : ""}`} onClick={() => showArchived(dispatch)}>
          <span className="nav-icon">A</span> Archived
        </button>
        <ExportButton className="nav-item">
          <span className="nav-icon">E</span> Export appraisal
        </ExportButton>
        <button className={`nav-item ${view === "settings" ? "active" : ""}`} onClick={() => dispatch(uiActions.setView("settings"))}>
          <span className="nav-icon">S</span> Settings
        </button>
      </nav>
      <div className="sidebar-tip">
        <span className="tip-label">WRITING TIP</span>
        <p>Use action + evidence + result. AI will polish the language, not invent the facts.</p>
      </div>
      <div className="sidebar-footer">
        <span className="status-dot"></span>
        <span id="save-status">{saveStatus}</span>
      </div>
    </aside>
  );
}

function Header({ user, license, settings, onLogout }) {
  const dispatch = useDispatch();
  const view = useSelector((state) => state.ui.view);
  const ai = useSelector((state) => state.ui.ai);
  const quarter = useSelector(selectActiveQuarter);
  const title = view === "master"
    ? "Create or upload master KPIs"
    : view === "archived"
      ? "Archived KPI records"
      : view === "settings"
        ? "Settings"
      : view === "workspace" && quarter
        ? quarterLabel(quarter)
        : "Quarterly KPI appraisals";
  const eyebrow = view === "master" ? "MASTER TEMPLATE" : view === "archived" ? "ARCHIVE" : view === "settings" ? "ADMINISTRATION" : view === "workspace" ? "QUARTERLY APPRAISAL" : "PERFORMANCE WORKSPACE";
  const aiReady = ai.aiConfigured && !ai.proxyError;
  const licenceMessage = license?.active
    ? `${license.plan || "Licensed"} licence active`
    : user.role === "admin"
      ? "Activate the licence in Settings"
      : "The app currently can't transact. Contact the system admin.";
  return (
    <header className="topbar">
      <div>
        <button className="back-button" hidden={view !== "workspace"} onClick={() => showHome(dispatch)}>Back to quarters</button>
        <p className="eyebrow" id="page-eyebrow">{eyebrow}</p>
        <h1 id="page-title">{title}</h1>
      </div>
      <div className="top-actions">
        <span className={`license-banner ${license?.active ? "active" : "inactive"}`}>{licenceMessage}</span>
        <button
          className={`ai-state ${aiReady ? "ready" : "offline"}`}
          type="button"
          onClick={() => !aiReady && window.dispatchEvent(new CustomEvent("open-ai-setup"))}
        >
          <span className="spark">*</span>{" "}
          {ai.proxyError ? "Proxy setup needed" : aiReady ? `AI ready${ai.proxyConfigured ? " via proxy" : ""}` : "AI setup needed"}
        </button>
        <ExportButton className="button ghost workspace-only" hidden={view !== "workspace"}>Export Excel</ExportButton>
        <div className="user-menu">
          <span>{user.firstName || user.username}</span>
          <small>{settings?.name || "KPI Assistant"}</small>
          <button type="button" onClick={onLogout}>Sign out</button>
        </div>
      </div>
    </header>
  );
}

function MainView({ user, license, settings, onActivateLicense, onSettingsSaved }) {
  const view = useSelector((state) => state.ui.view);
  if (view === "settings") return <SettingsView user={user} license={license} settings={settings} onActivateLicense={onActivateLicense} onSettingsSaved={onSettingsSaved} />;
  if (view === "master") return <MasterView />;
  if (view === "archived") return <ArchivedView />;
  if (view === "workspace") return <WorkspaceView />;
  return <HomeView />;
}

function SettingsView({ user, license, settings, onActivateLicense, onSettingsSaved }) {
  const dispatch = useDispatch();
  const [tab, setTab] = useState(user.role === "admin" ? "workspace" : "account");
  const [form, setForm] = useState({ name: settings?.name || "KPI Appraisal Assistant", timezone: settings?.timezone || "Africa/Nairobi" });
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [userForm, setUserForm] = useState({ firstName: "", lastName: "", username: "", password: "", confirmPassword: "" });
  const [licenseKey, setLicenseKey] = useState("");
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");
  const [generatedPassword, setGeneratedPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const logoInput = useRef();
  const tabs = useMemo(() => user.role === "admin" ? ["account", "workspace", "licence", "users"] : ["account"], [user.role]);
  const changePasswordMismatch = passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword;
  const addUserPasswordMismatch = userForm.confirmPassword && userForm.password !== userForm.confirmPassword;

  useEffect(() => {
    setForm({ name: settings?.name || "KPI Appraisal Assistant", timezone: settings?.timezone || "Africa/Nairobi" });
  }, [settings]);

  useEffect(() => {
    if (!tabs.includes(tab)) setTab(tabs[0]);
  }, [tab, tabs]);

  useEffect(() => {
    if (user.role !== "admin" || tab !== "users") return undefined;
    let cancelled = false;
    getUsers()
      .then((items) => { if (!cancelled) setUsers(items); })
      .catch((nextError) => dispatch(uiActions.showToast({ message: nextError.message, error: true })));
    return () => { cancelled = true; };
  }, [tab, user.role, dispatch]);

  async function submitSettings(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const nextSettings = await saveSettings(form);
      onSettingsSaved(nextSettings);
      dispatch(uiActions.showToast({ message: "Settings saved successfully." }));
    } catch (nextError) {
      setError(nextError.message || "Settings could not be saved.");
    } finally {
      setLoading(false);
    }
  }

  async function submitLicense(event) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await onActivateLicense(licenseKey);
      setLicenseKey("");
    } catch (nextError) {
      setError(nextError.message || "Licence activation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function uploadLogo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const nextSettings = await saveLogo(await fileToDataUrl(file));
      onSettingsSaved(nextSettings);
      dispatch(uiActions.showToast({ message: "Logo updated successfully." }));
    } catch (nextError) {
      setError(nextError.message || "Logo could not be saved.");
    } finally {
      event.target.value = "";
    }
  }

  async function removeCurrentLogo() {
    try {
      const nextSettings = await deleteLogo();
      onSettingsSaved(nextSettings);
      dispatch(uiActions.showToast({ message: "Logo removed successfully." }));
    } catch (nextError) {
      setError(nextError.message || "Logo could not be removed.");
    }
  }

  async function changeRole(id, role) {
    try {
      const updated = await updateUserRole(id, role);
      setUsers(users.map((item) => item.id === id ? updated : item));
      dispatch(uiActions.showToast({ message: "User role updated successfully." }));
    } catch (nextError) {
      dispatch(uiActions.showToast({ message: nextError.message, error: true }));
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    setError("");
    if (changePasswordMismatch || passwordForm.newPassword !== passwordForm.confirmPassword) return setError("Passwords do not match.");
    setLoading(true);
    try {
      await changePassword(passwordForm);
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      dispatch(uiActions.showToast({ message: "Password changed successfully." }));
    } catch (nextError) {
      setError(nextError.message || "Password could not be changed.");
    } finally {
      setLoading(false);
    }
  }

  async function addUser(event) {
    event.preventDefault();
    setError("");
    if (addUserPasswordMismatch || userForm.password !== userForm.confirmPassword) return setError("Passwords do not match.");
    setLoading(true);
    try {
      const created = await createUser(userForm);
      setUsers([...users, created].sort((a, b) => a.username.localeCompare(b.username)));
      setUserForm({ firstName: "", lastName: "", username: "", password: "", confirmPassword: "" });
      setGeneratedPassword("");
      dispatch(uiActions.showToast({ message: "User created successfully." }));
    } catch (nextError) {
      setError(nextError.message || "User could not be created.");
    } finally {
      setLoading(false);
    }
  }

  async function generateUserPassword() {
    const password = generateComplexPassword();
    setGeneratedPassword(password);
    setUserForm({ ...userForm, password, confirmPassword: password });
  }

  async function resetPassword(id) {
    const newPassword = generateComplexPassword();
    try {
      await resetUserPassword(id, newPassword);
      setGeneratedPassword(newPassword);
      dispatch(uiActions.showToast({ message: "Password reset successfully. Share the generated password securely." }));
    } catch (nextError) {
      dispatch(uiActions.showToast({ message: nextError.message, error: true }));
    }
  }

  async function setUserActive(id, active) {
    try {
      const updated = await updateUserActive(id, active);
      setUsers(users.map((item) => item.id === id ? updated : item));
      dispatch(uiActions.showToast({ message: active ? "User activated successfully." : "User deactivated successfully." }));
    } catch (nextError) {
      dispatch(uiActions.showToast({ message: nextError.message, error: true }));
    }
  }

  async function removeUser(id) {
    const confirmed = await confirmAction({
      title: "Delete this user?",
      text: "The user will be soft deleted and will no longer be able to sign in.",
      confirmText: "Delete user",
      danger: true
    });
    if (!confirmed) return;
    try {
      await deleteUser(id);
      setUsers(users.filter((item) => item.id !== id));
      dispatch(uiActions.showToast({ message: "User deleted successfully." }));
    } catch (nextError) {
      dispatch(uiActions.showToast({ message: nextError.message, error: true }));
    }
  }

  return (
    <section className="settings-panel">
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        {tabs.map((item) => (
          <button key={item} className={tab === item ? "active" : ""} type="button" onClick={() => { setTab(item); setError(""); }}>
            {titleCase(item)}
          </button>
        ))}
      </div>

      {tab === "account" && (
        <form className="settings-card" onSubmit={submitPassword}>
          <h2>Change password</h2>
          <label>Current password<input type="password" value={passwordForm.currentPassword} autoComplete="current-password" onChange={(event) => setPasswordForm({ ...passwordForm, currentPassword: event.target.value })} /></label>
          <label>New password<input type="password" value={passwordForm.newPassword} autoComplete="new-password" onChange={(event) => setPasswordForm({ ...passwordForm, newPassword: event.target.value })} /></label>
          <PasswordRules password={passwordForm.newPassword} />
          <label>Confirm new password<input type="password" value={passwordForm.confirmPassword} autoComplete="new-password" onChange={(event) => setPasswordForm({ ...passwordForm, confirmPassword: event.target.value })} /></label>
          <PasswordMatchMessage show={changePasswordMismatch} />
          {error && <div className="inline-error" role="alert">{error}</div>}
          <button className="button primary" disabled={loading}>{loading ? "Saving..." : "Change password"}</button>
        </form>
      )}

      {tab === "workspace" && (
        <form className="settings-card" onSubmit={submitSettings}>
          <h2>Workspace</h2>
          <div className="settings-logo-row">
            {settings?.logoData ? <img src={settings.logoData} alt="" /> : <span className="brand-mark">K</span>}
            <div>
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={uploadLogo} />
              <button className="button secondary" type="button" onClick={() => logoInput.current.click()}>Upload logo</button>
              <button className="button ghost" type="button" onClick={removeCurrentLogo}>Remove logo</button>
            </div>
          </div>
          <div className="edit-grid">
            <label>Application name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
            <label>Timezone<input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></label>
          </div>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <button className="button primary" disabled={loading || !license?.active}>{loading ? "Saving..." : "Save workspace settings"}</button>
        </form>
      )}

      {tab === "licence" && (
        <form className="settings-card" onSubmit={submitLicense}>
          <h2>Licence</h2>
          <div className={`license-summary ${license?.active ? "active" : "inactive"}`}>
            <strong>{license?.active ? "Active" : license?.status === "expired" ? "Expired" : "Inactive"}</strong>
            <span>{license?.organization || "No active organisation licence"}</span>
            {license?.expiresAt && <span>Expires {new Date(license.expiresAt).toLocaleDateString()}</span>}
          </div>
          <label>Signed licence key<textarea rows="7" value={licenseKey} placeholder="Paste the signed key from the licence generator" onChange={(event) => setLicenseKey(event.target.value)} /></label>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <button className="button primary" disabled={loading || !licenseKey.trim()}>{loading ? "Activating..." : "Activate licence"}</button>
        </form>
      )}

      {tab === "users" && (
        <section className="settings-card">
          <h2>User management</h2>
          <form className="user-create-form" onSubmit={addUser}>
            <div className="auth-grid">
              <label>First name<input value={userForm.firstName} onChange={(event) => setUserForm({ ...userForm, firstName: event.target.value })} /></label>
              <label>Last name<input value={userForm.lastName} onChange={(event) => setUserForm({ ...userForm, lastName: event.target.value })} /></label>
            </div>
            <label>Username<input value={userForm.username} onChange={(event) => setUserForm({ ...userForm, username: event.target.value })} /></label>
            <div className="password-line">
              <label>Password<input type="text" value={userForm.password} onChange={(event) => setUserForm({ ...userForm, password: event.target.value })} /></label>
              <button className="button secondary" type="button" onClick={generateUserPassword}>Generate</button>
            </div>
            <PasswordRules password={userForm.password} />
            <label>Confirm password<input type="text" value={userForm.confirmPassword} onChange={(event) => setUserForm({ ...userForm, confirmPassword: event.target.value })} /></label>
            <PasswordMatchMessage show={addUserPasswordMismatch} />
            {generatedPassword && <div className="success-panel" role="status">Generated password: <code>{generatedPassword}</code></div>}
            {error && <div className="inline-error" role="alert">{error}</div>}
            <button className="button primary" disabled={loading}>{loading ? "Creating..." : "Add editor user"}</button>
          </form>
          <div className="user-table">
            {users.map((item) => (
              <div className={`user-row ${item.active === false ? "inactive" : ""}`} key={item.id}>
                <div><strong>{item.firstName} {item.lastName}</strong><span>{item.username} | {item.active === false ? "Deactivated" : "Active"}</span></div>
                <select value={item.role} onChange={(event) => changeRole(item.id, event.target.value)}>
                  <option value="admin">Admin</option>
                  <option value="editor">Editor</option>
                  <option value="viewer">Viewer</option>
                </select>
                <div className="user-actions">
                  <button className="button ghost" type="button" onClick={() => resetPassword(item.id)}>Reset password</button>
                  <button className="button ghost" type="button" onClick={() => setUserActive(item.id, item.active === false)}>{item.active === false ? "Activate" : "Deactivate"}</button>
                  <button className="button danger" type="button" onClick={() => removeUser(item.id)}>Delete</button>
                </div>
              </div>
            ))}
            {!users.length && <p className="section-copy">No users found.</p>}
          </div>
        </section>
      )}
    </section>
  );
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsDataURL(file);
  });
}

function generateComplexPassword() {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%&*?";
  const all = upper + lower + digits + symbols;
  const pick = (chars) => chars[Math.floor(Math.random() * chars.length)];
  const chars = [pick(upper), pick(lower), pick(digits), pick(symbols)];
  while (chars.length < 12) chars.push(pick(all));
  return chars.sort(() => Math.random() - 0.5).join("");
}

function HomeView() {
  const dispatch = useDispatch();
  const workspace = useSelector(selectWorkspace);
  const availableYears = Object.keys(workspace.mastersByYear).sort((a, b) => Number(b) - Number(a));
  return (
    <section id="home-view">
      <section className="master-card">
        <div>
          <p className="eyebrow">MASTER KPI TEMPLATE</p>
          <h2>Your quarterly KPI source</h2>
          <p id="master-summary">
            {availableYears.length
              ? `Annual master templates available for ${availableYears.join(", ")}.`
              : "No annual master template has been created."}
          </p>
        </div>
        <button className="button secondary" onClick={() => showMaster(dispatch)}>Manage master KPIs</button>
      </section>
      <section className="workspace-header quarter-heading">
        <div>
          <p className="eyebrow">APPRAISAL HISTORY</p>
          <h2>Quarterly KPIs</h2>
          <p className="section-copy">Newest quarters appear first.</p>
        </div>
        <button className="button primary" onClick={() => window.dispatchEvent(new CustomEvent("open-quarter-dialog"))}>+ New quarter</button>
      </section>
      <section id="quarter-list" className="quarter-list">
        {[...workspace.quarters].sort(compareQuartersDescending).map((quarter) => (
          <QuarterCard key={quarter.id} quarter={quarter} />
        ))}
        {!workspace.quarters.length && (
          <div className="empty-state"><h3>No quarterly KPIs yet</h3><p>Create a quarter from your master KPI template.</p></div>
        )}
      </section>
    </section>
  );
}

function QuarterCard({ quarter }) {
  const dispatch = useDispatch();
  const { drafted, complete, progress } = summarizeKpis(quarter.kpis);
  const label = quarterLabel(quarter);
  async function remove() {
    const confirmed = await confirmAction({
      title: `Delete ${label}?`,
      text: "This permanently removes all KPIs, achievements, evidence, statuses and scores for this quarter.",
      confirmText: "Delete quarter",
      danger: true
    });
    if (!confirmed) return;
    dispatch(workspaceActions.deleteQuarter(quarter.id));
    dispatch(uiActions.showToast({ message: "Record deleted successfully." }));
  }
  async function archive(event) {
    event.stopPropagation();
    const confirmed = await confirmAction({
      title: `Archive ${label}?`,
      text: "Archived quarter KPIs remain viewable and can be activated again later.",
      confirmText: "Archive quarter"
    });
    if (!confirmed) return;
    dispatch(workspaceActions.archiveQuarter(quarter.id));
    dispatch(uiActions.showToast({ message: "Record archived successfully." }));
  }
  return (
    <article className="quarter-card">
      <button className="quarter-open" onClick={() => openQuarter(dispatch, quarter.id)}>
        <span className="quarter-badge">Q{quarter.quarter}</span>
        <span className="quarter-content">
          <span className="quarter-label">{label}</span>
          <span className="quarter-meta">{quarter.kpis.length} KPIs | {drafted} achievements drafted</span>
        </span>
        <span className="quarter-progress">{progress}% complete</span>
        <span className="quarter-arrow">›</span>
      </button>
      <div className="quarter-actions">
        <button className="quarter-archive" type="button" aria-label={`Archive ${label}`} onClick={archive}>Archive</button>
        <button className="quarter-delete" type="button" aria-label={`Delete ${label}`} onClick={remove}>Delete</button>
      </div>
    </article>
  );
}

function MasterView() {
  const dispatch = useDispatch();
  const years = useSelector(selectMasterYears);
  const workspace = useSelector(selectWorkspace);
  const master = useSelector(selectSelectedMaster);
  const fileRef = useRef();
  async function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = await importWorkbook(file);
      dispatch(workspaceActions.replaceSelectedMasterKpis({ kpis: data.kpis, source: file.name }));
      dispatch(uiActions.showToast({ message: "Records imported successfully." }));
    } catch (error) {
      dispatch(uiActions.showToast({ message: error.message || "Workbook import failed.", error: true }));
    } finally {
      event.target.value = "";
    }
  }
  function addYear() {
    const year = Number(window.prompt("Master KPI year", new Date().getFullYear()));
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      dispatch(uiActions.showToast({ message: "Enter a valid year between 2020 and 2100.", error: true }));
      return;
    }
    dispatch(workspaceActions.addMasterYear(year));
    dispatch(uiActions.showToast({ message: "Record added successfully." }));
  }
  async function archiveSelectedYear() {
    const year = workspace.selectedMasterYear;
    const selectedMaster = workspace.mastersByYear[String(year)];
    if (!selectedMaster) {
      dispatch(uiActions.showToast({ message: "No active master KPI year is selected.", error: true }));
      return;
    }
    const confirmed = await confirmAction({
      title: `Archive ${year} master KPIs?`,
      text: "Archived master KPIs remain viewable and can be activated again later. New quarters cannot use this year until it is activated.",
      confirmText: "Archive year"
    });
    if (!confirmed) return;
    dispatch(workspaceActions.archiveMasterYear(year));
    dispatch(uiActions.showToast({ message: "Record archived successfully." }));
    dispatch(uiActions.setView("archived"));
  }
  return (
    <section id="master-view">
      <section className="master-year-bar">
        <div>
          <span className="field-label">MASTER KPI YEAR</span>
          {years.length ? (
            <select value={workspace.selectedMasterYear} onChange={(event) => dispatch(workspaceActions.selectMasterYear(event.target.value))}>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
          ) : (
            <span className="archived-empty-note">No active master years</span>
          )}
        </div>
        <div className="master-year-actions">
          <button className="button ghost" onClick={addYear}>+ Add year</button>
          <button className="button danger" disabled={!years.length} onClick={archiveSelectedYear}>Archive year</button>
        </div>
      </section>
      {years.length ? (
        <>
          <section className="master-choice-grid">
            <article className="choice-card primary-choice">
              <span className="choice-number">01</span>
              <div>
                <p className="eyebrow">RECOMMENDED</p>
                <h2>Create <span className="selected-master-year-label">{workspace.selectedMasterYear}</span> master KPIs manually</h2>
                <p>Build the approved KPI structure directly in the app. This works even when the source Excel workbook is protected.</p>
              </div>
              <button className="button primary" onClick={() => window.dispatchEvent(new CustomEvent("edit-master-kpi"))}>+ Add master KPI</button>
            </article>
            <article className="choice-card">
              <span className="choice-number">02</span>
              <div>
                <p className="eyebrow">OPTIONAL</p>
                <h2>Upload a <span className="selected-master-year-label">{workspace.selectedMasterYear}</span> Excel file</h2>
                <p>Import a standard, unprotected <code>.xlsx</code> or <code>.csv</code> file and replace the master template.</p>
              </div>
              <button className="button secondary" onClick={() => fileRef.current.click()}>Choose workbook</button>
              <input ref={fileRef} type="file" accept=".xlsx,.csv" hidden onChange={upload} />
            </article>
          </section>
          <MasterTableSection
            title={`${workspace.selectedMasterYear} master KPI structure`}
            description="Quarters in this year copy this structure without carrying achievements or scores forward."
            kpis={master.kpis}
            year={workspace.selectedMasterYear}
            emptyTitle="No master KPIs yet"
            emptyCopy="Add the first KPI manually or upload an unprotected workbook."
            editable
          />
        </>
      ) : (
        <section className="master-kpi-list master-list-heading">
          <div className="empty-state"><h3>No active master KPI years</h3><p>Add a new year or activate an archived master template.</p></div>
        </section>
      )}
    </section>
  );
}

function ArchivedView() {
  const dispatch = useDispatch();
  const workspace = useSelector(selectWorkspace);
  const archivedYears = useSelector(selectArchivedMasterYears);
  const archivedQuarters = useSelector(selectArchivedQuarters);
  const [viewArchivedYear, setViewArchivedYear] = useState(null);
  const archivedMaster = viewArchivedYear
    ? workspace.archivedMastersByYear?.[String(viewArchivedYear)] || null
    : null;

  async function activateArchivedYear(year) {
    const confirmed = await confirmAction({
      title: `Activate ${year} master KPIs?`,
      text: "This will move them back into active master templates for editing and new quarter creation.",
      confirmText: "Activate year"
    });
    if (!confirmed) return;
    dispatch(workspaceActions.activateMasterYear(year));
    dispatch(uiActions.showToast({ message: "Record activated successfully." }));
    setViewArchivedYear(null);
    dispatch(uiActions.setView("master"));
  }

  async function activateArchivedQuarter(quarter) {
    const label = quarterLabel(quarter);
    if (workspace.quarters.some((item) => item.id === quarter.id)) {
      dispatch(uiActions.showToast({ message: `${label} already exists in active quarterly KPIs.`, error: true }));
      return;
    }
    const confirmed = await confirmAction({
      title: `Activate ${label}?`,
      text: "This will move the archived quarter back into active quarterly KPIs.",
      confirmText: "Activate quarter"
    });
    if (!confirmed) return;
    dispatch(workspaceActions.activateQuarter(quarter.id));
    dispatch(uiActions.showToast({ message: "Record activated successfully." }));
    dispatch(uiActions.setView("workspace"));
  }

  return (
    <section id="archived-view">
      <section className="workspace-header master-list-heading">
        <div>
          <p className="eyebrow">ARCHIVED MASTER KPIS</p>
          <h2>Archived annual templates</h2>
          <p className="section-copy">View archived master KPI years or activate them for editing and new quarter creation.</p>
        </div>
        <span className="master-count">{archivedYears.length} archived</span>
      </section>
      {archivedYears.length ? (
        <section className="archived-master-list">
          {archivedYears.map((year) => {
            const archived = workspace.archivedMastersByYear[String(year)];
            return (
              <article className={`archived-master-row ${viewArchivedYear === year ? "active" : ""}`} key={year}>
                <div>
                  <strong>{year} Master KPIs</strong>
                  <span>{archived.kpis.length} KPI{archived.kpis.length === 1 ? "" : "s"} archived</span>
                </div>
                <div className="master-table-actions">
                  <button className="button ghost" onClick={() => setViewArchivedYear(viewArchivedYear === year ? null : year)}>
                    {viewArchivedYear === year ? "Hide" : "View"}
                  </button>
                  <button className="button secondary" onClick={() => activateArchivedYear(year)}>Activate</button>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="master-kpi-list">
          <div className="empty-state"><h3>No archived master KPIs</h3><p>Archived master years will appear here.</p></div>
        </section>
      )}
      {archivedMaster && (
        <MasterTableSection
          title={`${viewArchivedYear} archived master KPI structure`}
          description="This archived template is read-only until you activate it."
          kpis={archivedMaster.kpis}
          year={viewArchivedYear}
          emptyTitle="No archived KPIs"
          emptyCopy="This archived year has no KPIs."
          editable={false}
        />
      )}

      <section className="workspace-header master-list-heading">
        <div>
          <p className="eyebrow">ARCHIVED QUARTER KPIS</p>
          <h2>Archived quarterly appraisals</h2>
          <p className="section-copy">Activate archived quarterly KPI records to continue working on them.</p>
        </div>
        <span className="master-count">{archivedQuarters.length} archived</span>
      </section>
      {archivedQuarters.length ? (
        <section className="archived-master-list">
          {archivedQuarters.map((quarter) => {
            const summary = summarizeKpis(quarter.kpis);
            return (
              <article className="archived-master-row" key={quarter.id}>
                <div>
                  <strong>{quarterLabel(quarter)}</strong>
                  <span>{quarter.kpis.length} KPIs | {summary.drafted} achievements drafted | {summary.progress}% complete</span>
                </div>
                <div className="master-table-actions">
                  <button className="button secondary" onClick={() => activateArchivedQuarter(quarter)}>Activate</button>
                </div>
              </article>
            );
          })}
        </section>
      ) : (
        <section className="master-kpi-list">
          <div className="empty-state"><h3>No archived quarter KPIs</h3><p>Archived quarterly KPI records will appear here.</p></div>
        </section>
      )}
    </section>
  );
}

function MasterTableSection({ title, description, kpis, year, emptyTitle, emptyCopy, editable }) {
  const dispatch = useDispatch();
  return (
    <>
      <section className="workspace-header master-list-heading">
        <div>
          <p className="eyebrow">{editable ? "MASTER TEMPLATE" : "ARCHIVED TEMPLATE"}</p>
          <h2>{title}</h2>
          <p className="section-copy">{description}</p>
        </div>
        <div className="master-table-actions">
          <button className="button secondary" type="button" onClick={() => downloadMasterExcel(dispatch, year, kpis)}>
            Download Excel
          </button>
          <button className="button secondary" type="button" onClick={() => downloadMasterCsv(year, kpis)}>
            Download CSV
          </button>
          <span className="master-count">{kpis.length} KPI{kpis.length === 1 ? "" : "s"}</span>
        </div>
      </section>
      {kpis.length ? (
        <section id={editable ? "master-kpi-list" : undefined} className="master-kpi-table-wrap" aria-label={title}>
          <table className={`master-kpi-table ${editable ? "editable" : "readonly"}`}>
            <thead>
              <tr>
                <th>No.</th>
                <th>Category</th>
                <th className="kpi-objective-column">KPI / Objective</th>
                <th>Tactical (Measure)</th>
                <th>Total Weight</th>
                <th>Description</th>
                {editable && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {kpis.map((kpi, index) => <MasterKpiRow key={kpi.id} kpi={kpi} index={index} editable={editable} />)}
            </tbody>
          </table>
        </section>
      ) : (
        <section id={editable ? "master-kpi-list" : undefined} className="master-kpi-list">
          <div className="empty-state"><h3>{emptyTitle}</h3><p>{emptyCopy}</p></div>
        </section>
      )}
    </>
  );
}

function MasterKpiRow({ kpi, index, editable = true }) {
  return (
    <tr className="master-kpi-row">
      <td><span className="master-index">{index + 1}</span></td>
      <td><span className="category">{kpi.category}</span></td>
      <td className="master-kpi-copy kpi-objective-column"><strong>{kpi.title}</strong></td>
      <td className="master-measure-preview">{kpi.measure || "No tactical measure supplied"}</td>
      <td className="master-weight">{kpi.weight || 0}%</td>
      <td className="master-description-preview">{kpi.description || "No description added"}</td>
      {editable && <td><button className="button ghost" onClick={() => window.dispatchEvent(new CustomEvent("edit-master-kpi", { detail: kpi }))}>Edit</button></td>}
    </tr>
  );
}

async function downloadMasterExcel(dispatch, year, kpis) {
  if (!kpis.length) {
    dispatch?.(uiActions.showToast({ message: "Add master KPIs before downloading Excel.", error: true }));
    return;
  }
  try {
    const response = await exportMasterWorkbook(year, kpis);
    const blob = await response.blob();
    downloadBlob(blob, response.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || `${year || "master"}-master-kpis.xlsx`);
  } catch (error) {
    dispatch?.(uiActions.showToast({ message: error.message || "Master KPI export failed.", error: true }));
  }
}

function downloadMasterCsv(year, kpis) {
  const headers = ["Category", "KPI / Objective", "Tactical (Measure)", "Total Weight", "Description", "Target"];
  const rows = [
    headers,
    ...(kpis.length
      ? kpis.map((kpi) => [
          kpi.category,
          kpi.title,
          kpi.measure,
          kpi.weight || 0,
          kpi.description,
          kpi.target || "100%"
        ])
      : [["", "", "", "", "", "100%"]])
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `${year || "master"}-master-kpis.csv`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function WorkspaceView() {
  const quarter = useSelector(selectActiveQuarter);
  const profile = useSelector(selectProfile);
  const [query, setQuery] = useState("");
  if (!quarter) return <HomeView />;
  const kpis = quarter.kpis.filter((kpi) =>
    [kpi.title, kpi.category, kpi.description, kpi.measure].join(" ").toLowerCase().includes(query.trim().toLowerCase())
  );
  return (
    <section id="workspace-view">
      <ProfileCard profile={profile} quarter={quarter} />
      <SummaryGrid kpis={quarter.kpis} />
      <section className="workspace-header">
        <div>
          <p className="eyebrow">YOUR SCORECARD</p>
          <h2>Key performance indicators</h2>
        </div>
        <div className="workspace-actions">
          <label className="search-box">
            <span>⌕</span>
            <input type="search" placeholder="Search KPIs" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <button className="button primary" onClick={() => window.dispatchEvent(new CustomEvent("edit-kpi", { detail: null }))}>+ Add KPI</button>
        </div>
      </section>
      <section id="kpi-list" className="kpi-list">
        {kpis.map((kpi) => <KpiCard key={kpi.id} kpi={kpi} index={quarter.kpis.indexOf(kpi)} />)}
      </section>
    </section>
  );
}

function ProfileCard({ profile, quarter }) {
  const dispatch = useDispatch();
  const initials = (profile.employee || "KPI").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const fields = ["employee", "role", "department", "manager"];
  return (
    <section className="profile-card">
      <div className="profile-heading">
        <div className="avatar">{initials}</div>
        <div>
          <h2>Appraisal details</h2>
          <p>Set the context once; it will be included in your export.</p>
        </div>
      </div>
      <div className="profile-grid">
        {fields.map((field) => (
          <label key={field}>{titleCase(field)}
            <input value={profile[field]} placeholder={field === "employee" ? "Your full name" : field === "role" ? "Job title" : field === "manager" ? "Manager's name" : "Department"} onChange={(event) => dispatch(workspaceActions.updateProfileField({ field, value: event.target.value }))} />
          </label>
        ))}
        <label>Review period<input value={quarterLabel(quarter)} readOnly /></label>
      </div>
    </section>
  );
}

function SummaryGrid({ kpis }) {
  const summary = summarizeKpis(kpis);
  return (
    <section className="summary-grid" aria-label="KPI summary">
      <article className="summary-card accent">
        <span className="summary-label">OVERALL PROGRESS</span>
        <strong>{summary.progress}%</strong>
        <div className="progress-track"><span style={{ width: `${summary.progress}%` }}></span></div>
      </article>
      <article className="summary-card">
        <span className="summary-label">KPI WEIGHT</span>
        <strong>{summary.weight}%</strong>
        <small>{summary.weight === 100 ? "Balanced scorecard" : "Target total: 100%"}</small>
      </article>
      <article className="summary-card">
        <span className="summary-label">ACHIEVEMENTS DRAFTED</span>
        <strong>{summary.drafted} / {kpis.length}</strong>
        <small>Keep adding measurable evidence</small>
      </article>
      <article className="summary-card">
        <span className="summary-label">TOTAL SCORE</span>
        <strong>{formatScore(summary.totalScore)}%</strong>
        <small>{summary.complete} KPI{summary.complete === 1 ? "" : "s"} marked complete</small>
      </article>
    </section>
  );
}

function KpiCard({ kpi, index }) {
  const dispatch = useDispatch();
  const words = kpi.achievement.trim() ? kpi.achievement.trim().split(/\s+/).length : 0;
  const patch = (field, value) => dispatch(workspaceActions.patchKpi({ id: kpi.id, patch: { [field]: value } }));
  return (
    <article className="kpi-card">
      <div className="kpi-card-top">
        <div className="kpi-number">{index + 1}</div>
        <div className="kpi-title-block">
          <div className="category-line">
            <span className="category">{kpi.category || "General"}</span>
            <span className="weight-pill">{Number(kpi.weight) || 0}% weight</span>
          </div>
          <h3 className="title" title={kpi.title}>{kpi.title}</h3>
          <p className="description">{kpi.description || "No description added."}</p>
        </div>
        <select className="status-select" aria-label="KPI status" value={kpi.status} data-status={kpi.status} onChange={(event) => patch("status", event.target.value)}>
          <option value="not-started">Not started</option>
          <option value="in-progress">In progress</option>
          <option value="complete">Complete</option>
        </select>
        <button className="icon-button more-button" aria-label="KPI options" onClick={() => window.dispatchEvent(new CustomEvent("edit-kpi", { detail: kpi }))}>•••</button>
      </div>
      <div className="measure-row">
        <div><span className="field-label">MEASURE</span><p className="measure">{kpi.measure || "Not specified"}</p></div>
        <div><span className="field-label">TARGET</span><p className="target">100%</p></div>
      </div>
      <div className="score-row">
        <label><span className="field-label">SELF-APPRAISAL %</span>
          <input className="self-appraisal" type="number" min="0" max="200" step="1" value={kpi.selfAppraisal || ""} placeholder="0" onChange={(event) => patch("selfAppraisal", Math.min(200, Math.max(0, Number(event.target.value) || 0)))} />
        </label>
        <div className="score-result">
          <span className="field-label">TOTAL SCORE %</span>
          <strong className="weighted-score">{formatScore(weightedKpiScore(kpi))}%</strong>
          <small>Weight x Self-Appraisal</small>
        </div>
      </div>
      <div className="editor-grid">
        <label><span className="field-label">YOUR ACHIEVEMENT</span>
          <textarea className="achievement" rows="5" placeholder="What did you deliver? Include scope, numbers, outcome and who benefited." value={kpi.achievement} onChange={(event) => patch("achievement", event.target.value)} />
          <span className="character-count">{words} word{words === 1 ? "" : "s"}</span>
        </label>
        <label><span className="field-label">SUPPORTING EVIDENCE</span>
          <textarea className="evidence" rows="5" placeholder="Links, report names, dates, feedback or other proof." value={kpi.evidence} onChange={(event) => patch("evidence", event.target.value)} />
        </label>
      </div>
      <div className="card-footer">
        <span className="draft-state">{kpi.achievement.trim() ? "Draft saved" : "Draft"}</span>
        <button className="button refine-button" onClick={() => window.dispatchEvent(new CustomEvent("refine-kpi", { detail: kpi }))}><span>*</span> Refine with AI</button>
      </div>
    </article>
  );
}

function Dialogs() {
  return (
    <>
      <KpiDialog />
      <MasterKpiDialog />
      <QuarterDialog />
      <AiDialog />
      <AiSetupDialog />
    </>
  );
}

function KpiDialog() {
  const dispatch = useDispatch();
  const quarter = useSelector(selectActiveQuarter);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const handler = (event) => {
      setError("");
      setEditing(event.detail || cleanKpi({ id: crypto.randomUUID(), category: "General", title: "New KPI" }));
    };
    window.addEventListener("edit-kpi", handler);
    return () => window.removeEventListener("edit-kpi", handler);
  }, []);
  if (!editing) return null;
  const exists = quarter?.kpis.some((kpi) => kpi.id === editing.id);
  function submit(event) {
    event.preventDefault();
    const title = cleanMultiline(editing.title);
    if (!title) {
      setError("KPI / Objective is required.");
      return dispatch(uiActions.showToast({ message: "KPI / Objective is required.", error: true }));
    }
    const payload = cleanKpi({ ...editing, title });
    dispatch(exists ? workspaceActions.updateKpi(payload) : workspaceActions.addKpi(payload));
    setEditing(null);
    dispatch(uiActions.showToast({ message: exists ? "Record updated successfully." : "Record added successfully." }));
  }
  async function remove() {
    const confirmed = await confirmAction({
      title: "Remove this KPI?",
      text: editing.title,
      confirmText: "Remove KPI",
      danger: true
    });
    if (!confirmed) return;
    dispatch(workspaceActions.deleteKpi(editing.id));
    setEditing(null);
    dispatch(uiActions.showToast({ message: "Record deleted successfully." }));
  }
  return (
    <Modal className="edit-modal" onClose={() => setEditing(null)}>
      <form method="dialog" className="modal-card" onSubmit={submit} noValidate>
        <DialogTitle eyebrow="KPI DETAILS" title="Edit KPI" onClose={() => setEditing(null)} />
        <EditGrid value={editing} onChange={setEditing} weightLabel="Weight (%)" />
        {error && <span className="form-error" role="alert">{error}</span>}
        <div className="modal-actions split-actions">
          <button className="button danger" type="button" hidden={!exists} onClick={remove}>Delete KPI</button>
          <div><button className="button ghost" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="button primary" type="submit">Save changes</button></div>
        </div>
      </form>
    </Modal>
  );
}

function MasterKpiDialog() {
  const dispatch = useDispatch();
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const master = useSelector(selectSelectedMaster);
  useEffect(() => {
    const handler = (event) => {
      setError("");
      setEditing(event.detail || cleanKpi({ id: crypto.randomUUID(), category: "General", title: "" }));
    };
    window.addEventListener("edit-master-kpi", handler);
    return () => window.removeEventListener("edit-master-kpi", handler);
  }, []);
  if (!editing) return null;
  const exists = master.kpis.some((kpi) => kpi.id === editing.id);
  function submit(event) {
    event.preventDefault();
    const title = cleanMultiline(editing.title);
    if (!title) {
      setError("KPI / Objective is required.");
      return dispatch(uiActions.showToast({ message: "KPI / Objective is required.", error: true }));
    }
    dispatch(workspaceActions.upsertMasterKpi(cleanKpi({ ...editing, title })));
    setEditing(null);
    dispatch(uiActions.showToast({ message: exists ? "Record updated successfully." : "Record added successfully." }));
  }
  async function remove() {
    const confirmed = await confirmAction({
      title: "Remove this master KPI?",
      text: editing.title,
      confirmText: "Remove KPI",
      danger: true
    });
    if (!confirmed) return;
    dispatch(workspaceActions.deleteMasterKpi(editing.id));
    setEditing(null);
    dispatch(uiActions.showToast({ message: "Record deleted successfully." }));
  }
  return (
    <Modal className="edit-modal" onClose={() => setEditing(null)}>
      <form method="dialog" className="modal-card" onSubmit={submit} noValidate>
        <DialogTitle eyebrow="MASTER TEMPLATE" title={exists ? "Edit master KPI" : "Add master KPI"} onClose={() => setEditing(null)} />
        <EditGrid value={editing} onChange={setEditing} weightLabel="Total Weight (%)" />
        {error && <span className="form-error" role="alert">{error}</span>}
        <div className="modal-actions split-actions">
          <button className="button danger" type="button" hidden={!exists} onClick={remove}>Delete KPI</button>
          <div><button className="button ghost" type="button" onClick={() => setEditing(null)}>Cancel</button><button className="button primary" type="submit">Save master KPI</button></div>
        </div>
      </form>
    </Modal>
  );
}

function EditGrid({ value, onChange, weightLabel }) {
  const set = (field, next) => onChange({ ...value, [field]: next });
  return (
    <div className="edit-grid">
      <label>Category<input value={value.category} placeholder="e.g. Service Delivery" onChange={(event) => set("category", cleanSingleLine(event.target.value))} /></label>
      <label className="wide">KPI / Objective<textarea rows="4" required value={value.title} placeholder="KPI or objective" onChange={(event) => set("title", event.target.value)} /></label>
      <label>Tactical (Measure)<textarea rows="3" value={value.measure} placeholder="How will performance be measured?" onChange={(event) => set("measure", event.target.value)} /></label>
      <label>{weightLabel}<input type="number" min="0" max="100" step="1" value={value.weight} onChange={(event) => set("weight", Number(event.target.value) || 0)} /></label>
      <label className="wide">Description<textarea rows="3" value={value.description} placeholder="Optional supporting context" onChange={(event) => set("description", event.target.value)} /></label>
      <label>Target<input value="100%" readOnly /></label>
    </div>
  );
}

function QuarterDialog() {
  const dispatch = useDispatch();
  const workspace = useSelector(selectWorkspace);
  const [open, setOpen] = useState(false);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [error, setError] = useState("");
  useEffect(() => {
    const handler = () => {
      setError("");
      setOpen(true);
    };
    window.addEventListener("open-quarter-dialog", handler);
    return () => window.removeEventListener("open-quarter-dialog", handler);
  }, []);
  if (!open) return null;
  function submit(event) {
    event.preventDefault();
    const id = `${year}-q${quarter}`;
    if (workspace.quarters.some((item) => item.id === id)) {
      const message = `${year} Quarter ${quarter} already exists.`;
      setError(message);
      return dispatch(uiActions.showToast({ message, error: true }));
    }
    if (!workspace.mastersByYear[String(year)]?.kpis?.length) {
      const message = `Create or upload the ${year} master KPIs before creating this quarter.`;
      setError(message);
      return dispatch(uiActions.showToast({ message, error: true }));
    }
    dispatch(workspaceActions.createQuarter({ year: Number(year), quarter: Number(quarter) }));
    dispatch(uiActions.setView("workspace"));
    setOpen(false);
    dispatch(uiActions.showToast({ message: "Record added successfully." }));
  }
  return (
    <Modal className="quarter-modal" onClose={() => setOpen(false)}>
      <form method="dialog" className="modal-card" onSubmit={submit} noValidate>
        <DialogTitle eyebrow="NEW APPRAISAL" title="Create quarterly KPIs" onClose={() => setOpen(false)} />
        <p className="modal-context">The KPI structure will be copied from your master template. Achievements and evidence start blank.</p>
        <div className="edit-grid">
          <label>Year<input type="number" min="2020" max="2100" required value={year} onChange={(event) => { setError(""); setYear(Number(event.target.value)); }} /></label>
          <label>Quarter<select value={quarter} onChange={(event) => { setError(""); setQuarter(Number(event.target.value)); }}>{[1, 2, 3, 4].map((item) => <option key={item} value={item}>Q{item}</option>)}</select></label>
        </div>
        {error && <span className="form-error" role="alert">{error}</span>}
        <div className="modal-actions"><button className="button ghost" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="button primary" type="submit">Create quarter</button></div>
      </form>
    </Modal>
  );
}

function AiDialog() {
  const dispatch = useDispatch();
  const ai = useSelector((state) => state.ui.ai);
  const quarter = useSelector(selectActiveQuarter);
  const [kpi, setKpi] = useState(null);
  const [tone, setTone] = useState("confident");
  const [instruction, setInstruction] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const handler = (event) => {
      if (!ai.aiConfigured || ai.proxyError) return window.dispatchEvent(new CustomEvent("open-ai-setup"));
      if (!event.detail.achievement.trim()) return dispatch(uiActions.showToast({ message: "Add an achievement draft first. AI needs your facts to work with.", error: true }));
      setKpi(event.detail);
      setResult("");
      setError("");
    };
    window.addEventListener("refine-kpi", handler);
    return () => window.removeEventListener("refine-kpi", handler);
  }, [ai, dispatch]);
  if (!kpi) return null;
  async function generate() {
    setLoading(true);
    setError("");
    try {
      const data = await refineAchievement({ kpi, tone, instruction });
      setResult(cleanMultiline(data.refined));
    } catch (nextError) {
      setError(nextError.message || "Refinement failed.");
    } finally {
      setLoading(false);
    }
  }
  function accept() {
    const current = quarter?.kpis.find((item) => item.id === kpi.id);
    if (!current || !result) return;
    dispatch(workspaceActions.patchKpi({ id: kpi.id, patch: { achievement: result } }));
    setKpi(null);
    dispatch(uiActions.showToast({ message: "Record updated successfully." }));
  }
  return (
    <Modal onClose={() => setKpi(null)}>
      <form method="dialog" className="modal-card">
        <DialogTitle eyebrow="AI WRITING COACH" title="Refine this achievement" onClose={() => setKpi(null)} />
        <p className="modal-context">{kpi.title}</p>
        <label>Tone<select value={tone} onChange={(event) => setTone(event.target.value)}><option value="confident">Confident and concise</option><option value="executive">Executive and strategic</option><option value="evidence-led">Evidence-led and precise</option><option value="growth-focused">Growth-focused and reflective</option></select></label>
        <label>Additional direction<input value={instruction} placeholder="e.g. Emphasize customer impact" onChange={(event) => setInstruction(event.target.value)} /></label>
        <div className="before-after">
          <div><span className="field-label">YOUR DRAFT</span><div className="text-preview">{kpi.achievement}</div></div>
          <div><span className="field-label">REFINED VERSION</span><div className={`text-preview result ${result ? "" : "empty"}`}>{result || "Your refined version will appear here."}</div></div>
        </div>
        {error && <div className="inline-error" role="alert">{error}</div>}
        <div className="modal-actions"><button className="button ghost" type="button" onClick={() => setKpi(null)}>Cancel</button><button className="button secondary" type="button" disabled={loading} onClick={generate}><span>*</span> {loading ? "Refining..." : "Refine with AI"}</button><button className="button primary" type="button" disabled={!result} onClick={accept}>Use this version</button></div>
      </form>
    </Modal>
  );
}

function AiSetupDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("open-ai-setup", handler);
    return () => window.removeEventListener("open-ai-setup", handler);
  }, []);
  if (!open) return null;
  return (
    <Modal className="setup-modal" onClose={() => setOpen(false)}>
      <form method="dialog" className="modal-card">
        <DialogTitle eyebrow="OPENAI SETUP" title="Enable AI refinement" onClose={() => setOpen(false)} />
        <p className="modal-context">The app needs an OpenAI API key on the local server. A ChatGPT subscription does not automatically provide an API key.</p>
        <ol className="setup-steps"><li>Create an API key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">platform.openai.com/api-keys</a>.</li><li>Create a file named <code>.env</code> in the application folder.</li><li>Add the following values:</li></ol>
        <pre className="setup-code">OPENAI_API_KEY=your_actual_api_key{"\n"}OPENAI_MODEL=gpt-5.5{"\n"}OPENAI_PROXY_URL=http://proxy.company.com:8080{"\n"}PORT=3010</pre>
        <p className="setup-note">Leave <code>OPENAI_PROXY_URL</code> blank when no proxy is required. Restart the app after saving. Secrets stay on the server and are never sent to browser storage.</p>
        <div className="modal-actions"><button className="button primary" type="button" onClick={() => setOpen(false)}>Got it</button></div>
      </form>
    </Modal>
  );
}

function Modal({ children, className = "", onClose }) {
  const dialogRef = useRef();
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return <dialog ref={dialogRef} className={`modal ${className}`} onCancel={onClose}>{children}</dialog>;
}

function DialogTitle({ eyebrow, title, onClose }) {
  return (
    <div className="modal-header">
      <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
      <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>×</button>
    </div>
  );
}

function ExportButton({ children, className, hidden }) {
  const dispatch = useDispatch();
  const quarter = useSelector(selectActiveQuarter);
  const profile = useSelector(selectProfile);
  async function download() {
    if (!quarter) return dispatch(uiActions.showToast({ message: "Open a quarterly appraisal before exporting.", error: true }));
    try {
      const response = await exportWorkbook({ ...profile, period: quarterLabel(quarter) }, quarter.kpis);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] || "kpi-appraisal.xlsx";
      link.click();
      URL.revokeObjectURL(url);
      dispatch(uiActions.showToast({ message: `${quarterLabel(quarter)} exported to Excel.` }));
    } catch (error) {
      dispatch(uiActions.showToast({ message: error.message || "Export failed.", error: true }));
    }
  }
  return <button className={className} hidden={hidden} onClick={download}>{children}</button>;
}

function ToastRegion() {
  const dispatch = useDispatch();
  const toast = useSelector((state) => state.ui.toast);
  useEffect(() => {
    if (!toast) return undefined;
    const timeout = setTimeout(() => dispatch(uiActions.clearToast()), 4500);
    return () => clearTimeout(timeout);
  }, [toast, dispatch]);
  return <div id="toast-region" className="toast-region" aria-live="polite">{toast && <div className={`toast${toast.error ? " error" : ""}`}>{toast.message}</div>}</div>;
}

function showHome(dispatch) {
  dispatch(workspaceActions.setActiveQuarter(null));
  dispatch(uiActions.setView("home"));
}

function showMaster(dispatch) {
  dispatch(workspaceActions.setActiveQuarter(null));
  dispatch(uiActions.setView("master"));
}

function showArchived(dispatch) {
  dispatch(workspaceActions.setActiveQuarter(null));
  dispatch(uiActions.setView("archived"));
}

function openQuarter(dispatch, id) {
  dispatch(workspaceActions.setActiveQuarter(id));
  dispatch(uiActions.setView("workspace"));
}

function titleCase(value) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
