import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { api, nav, usePath, ToastHost } from './lib.jsx';
import Tobi from './tobi.jsx';
import Case360 from './case.jsx';
import G2 from './g2.jsx';
import { Programme, Systems, Security } from './trust.jsx';
import { Shell, Login, Command, Workbench, Cases, Audit, Policies, Demo, QR, Scan } from './staff.jsx';

function App() {
  const path = usePath();
  const [me, setMe] = useState(undefined);
  useEffect(() => { if (!path.startsWith('/tobi') && path !== '/scan') api('/me').then(setMe).catch(() => setMe(null)); }, [path === '/login']);
  if (path.startsWith('/tobi')) return <Tobi />;
  if (path === '/scan') return <Scan />;
  if (me === undefined) return null;
  if (!me) return <Login onLogin={(u) => { setMe(u); if (path === '/login') nav('/'); }} />;
  const logout = async () => { await api('/logout', {}); setMe(null); nav('/login'); };
  if (path.startsWith('/g2')) return me.perms.includes('g2.view') ? <G2 me={me} /> : <Shell me={me} path={path} onLogout={logout}><div className="card pad">Your role has no access to G2.</div></Shell>;
  let page;
  if (path === '/' || path === '/login') page = <Command me={me} />;
  else if (path === '/work') page = <Workbench me={me} />;
  else if (path === '/cases') page = <Cases />;
  else if (path.startsWith('/case/')) page = <Case360 refId={decodeURIComponent(path.slice(6))} me={me} />;
  else if (path === '/audit') page = <Audit me={me} />;
  else if (path === '/policies') page = <Policies me={me} />;
  else if (path === '/programme') page = <Programme />;
  else if (path === '/systems') page = <Systems />;
  else if (path === '/security') page = <Security me={me} />;
  else if (path === '/demo') page = <Demo />;
  else if (path === '/qr') page = <QR />;
  else page = <div className="card pad">Page not found.</div>;
  return <Shell me={me} path={path} onLogout={logout}>{page}</Shell>;
}
createRoot(document.getElementById('root')).render(<ToastHost><App /></ToastHost>);
