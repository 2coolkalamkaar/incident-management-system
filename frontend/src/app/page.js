"use client";

import { useEffect, useState, useRef } from 'react';
import './globals.css';

const RealtimeGraph = ({ history, currentRate, totalDropped }) => {
  const maxVal = Math.max(...history, 100);
  const width = 240;
  const height = 50;
  
  let stepPoints = '';
  for(let i=0; i<history.length-1; i++) {
    const x1 = (i / (history.length - 1)) * width;
    const x2 = ((i+1) / (history.length - 1)) * width;
    const y1 = height - (history[i] / maxVal) * height;
    const y2 = height - (history[i+1] / maxVal) * height;
    stepPoints += `${x1},${y1} ${x2},${y1} `;
    if (i === history.length - 2) {
      stepPoints += `${x2},${y2}`;
    }
  }
  if (!stepPoints) stepPoints = `0,${height} ${width},${height}`;

  return (
    <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', padding: '1rem 1.5rem', minWidth: '300px' }}>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '1px', marginBottom: '0.5rem' }}>
        REAL-TIME CONCURRENCY (TOTAL SIGNALS)
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
          <span className="monospace" style={{ fontSize: '2.5rem', color: '#fff', fontWeight: 800, lineHeight: '1' }}>{currentRate}</span>
          <span className="monospace" style={{ fontSize: '1rem', color: 'var(--text-muted)' }}>/sec</span>
        </div>
        
        <div style={{ display: 'flex', gap: '1rem' }}>
          <div style={{ padding: '0.25rem 0.5rem', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px' }}>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginBottom: '0.2rem' }}>PEAK DEBOUNCED</div>
            <div className="monospace" style={{ fontSize: '0.85rem', color: '#f59e0b' }}>{totalDropped.toLocaleString()}</div>
          </div>
        </div>
      </div>
      
      <div style={{ position: 'relative', width: '100%', height: `${height}px` }}>
        <svg width="100%" height="100%" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
          <defs>
            <linearGradient id="stepGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="rgba(16, 185, 129, 0.3)" />
              <stop offset="100%" stopColor="rgba(16, 185, 129, 0)" />
            </linearGradient>
          </defs>
          <polygon 
            points={`0,${height} ${stepPoints} ${width},${height}`} 
            fill="url(#stepGradient)" 
          />
          <polyline 
            points={stepPoints} 
            fill="none" 
            stroke="#10b981" 
            strokeWidth="2" 
          />
        </svg>
      </div>
    </div>
  );
};

const DependencyMap = ({ targetComponent }) => {
  let nodes = [];
  
  if (targetComponent.includes('RDBMS') || targetComponent.includes('DB')) {
    nodes = [
      { id: 'Web Frontend', status: 'ok' },
      { id: 'API Gateway', status: 'ok' },
      { id: 'Checkout Service', status: 'warning' },
      { id: targetComponent, status: 'error' }
    ];
  } else if (targetComponent.includes('MCP') || targetComponent.includes('MODEL') || targetComponent.includes('AI')) {
    nodes = [
      { id: 'Chat Interface', status: 'ok' },
      { id: 'API Gateway', status: 'ok' },
      { id: 'Inference Router', status: 'warning' },
      { id: targetComponent, status: 'error' },
      { id: 'Vector DB', status: 'ok' }
    ];
  } else {
    nodes = [
      { id: 'Mobile Client', status: 'ok' },
      { id: 'Load Balancer', status: 'ok' },
      { id: 'Core Services', status: 'warning' },
      { id: targetComponent, status: 'error' }
    ];
  }

  const getNodeColor = (status) => {
    switch (status) {
      case 'ok': return '#10b981'; // Green
      case 'warning': return '#eab308'; // Yellow
      case 'error': return '#ef4444'; // Red
      default: return '#8b8b9d';
    }
  };

  return (
    <div style={{ marginBottom: '2rem' }}>
      <h4 style={{ color: 'var(--text-main)', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        Distributed Trace Map
      </h4>
      <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto', padding: '1.5rem', background: 'rgba(0,0,0,0.4)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
        {nodes.map((node, idx) => (
          <div key={idx} style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ 
              padding: '0.75rem 1rem', 
              borderRadius: '6px', 
              border: `1px solid ${getNodeColor(node.status)}`,
              background: `rgba(${node.status === 'error' ? '239, 68, 68' : node.status === 'warning' ? '234, 179, 8' : '16, 185, 129'}, 0.1)`,
              color: '#fff',
              whiteSpace: 'nowrap',
              boxShadow: node.status === 'error' ? '0 0 15px rgba(239, 68, 68, 0.4)' : 'none'
            }}>
              <div style={{ fontSize: '0.7rem', color: getNodeColor(node.status), fontWeight: 800, letterSpacing: '1px', marginBottom: '0.25rem' }}>
                {node.status === 'error' ? 'FAILING' : node.status === 'warning' ? 'DEGRADED' : 'HEALTHY'}
              </div>
              <div className="monospace" style={{ fontSize: '0.85rem' }}>{node.id}</div>
            </div>
            
            {idx < nodes.length - 1 && (
              <div style={{ margin: '0 0.5rem', display: 'flex', alignItems: 'center' }}>
                <div style={{ width: '30px', height: '2px', background: 'var(--border-color)' }} />
                <div style={{ 
                  width: 0, height: 0, 
                  borderTop: '5px solid transparent',
                  borderBottom: '5px solid transparent',
                  borderLeft: '5px solid var(--border-color)' 
                }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default function Dashboard() {
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [signals, setSignals] = useState([]);
  const [loadingSignals, setLoadingSignals] = useState(false);
  const [similarIncidents, setSimilarIncidents] = useState([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [timeline, setTimeline] = useState([]);

  // RCA Form State
  const [rcaForm, setRcaForm] = useState({ root_cause_category: '', fix_applied: '', prevention_steps: '' });
  const [rcaStatus, setRcaStatus] = useState({ message: '', error: false });
  const [isSimulating, setIsSimulating] = useState(false);
  const [isGeneratingRca, setIsGeneratingRca] = useState(false);

  // MTTR Analytics State
  const [mttr, setMttr] = useState({ total_count: 0, active_count: 0, closed_count: 0, avg_mttr_seconds: 0 });
  const [droppedSignals, setDroppedSignals] = useState(0);
  const [signalHistory, setSignalHistory] = useState(Array(30).fill(0));
  const [currentRate, setCurrentRate] = useState(0);
  
  const prevDroppedRef = useRef(0);
  const latestDroppedRef = useRef(0);

  useEffect(() => {
    latestDroppedRef.current = droppedSignals;
  }, [droppedSignals]);

  useEffect(() => {
    // Tick every 1 second to calculate rate and shift history array
    const interval = setInterval(() => {
      const currentTotal = latestDroppedRef.current;
      const rate = currentTotal - prevDroppedRef.current;
      prevDroppedRef.current = currentTotal;
      
      setCurrentRate(rate);
      setSignalHistory(prev => {
        const next = [...prev.slice(1), rate];
        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const runSimulation = async () => {
    if (isSimulating) return;
    setIsSimulating(true);
    try {
      await fetch('/api/simulate', { method: 'POST' });
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => setIsSimulating(false), 2000);
    }
  };

  const fetchIncidents = async () => {
    try {
      const res = await fetch('/api/incidents');
      if (res.ok) {
        const data = await res.json();
        setIncidents(data);
        // Update selected incident if its status changed (using functional update to avoid stale closures)
        setSelectedIncident(prev => {
          if (prev) {
            const updated = data.find(i => i.id === prev.id);
            return updated || prev;
          }
          return prev;
        });
      }
    } catch (err) {
      console.error("Failed to fetch incidents", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchMttr = async () => {
    try {
      const res = await fetch('/api/analytics/mttr');
      if (res.ok) {
        const data = await res.json();
        setMttr(data);
      }
    } catch (err) {
      console.error("Failed to fetch MTTR", err);
    }
  };

  useEffect(() => {
    // Initial fetch
    fetchIncidents();
    fetchMttr();

    // SSE connection for Real-Time Streaming (Replaces 5s polling)
    const sse = new EventSource('/api/stream');
    
    sse.addEventListener('refresh', () => {
      fetchIncidents();
      fetchMttr();
    });

    sse.addEventListener('debounce', (e) => {
      const data = JSON.parse(e.data);
      setDroppedSignals(data.count || 0);
    });

    return () => sse.close();
  }, []); // Run only once on mount

  const openIncident = async (incident) => {
    setSelectedIncident(incident);
    setLoadingSignals(true);
    setSignals([]);
    setSimilarIncidents([]);
    setLoadingSimilar(true);
    setRcaStatus({ message: '', error: false });
    setRcaForm({ root_cause_category: '', fix_applied: '', prevention_steps: '' });
    setTimeline([]);
    
    try {
      const res = await fetch(`/api/incidents/${incident.id}/signals`);
      if (res.ok) {
        const data = await res.json();
        setSignals(data);
      }
      
      const simRes = await fetch(`/api/incidents/${incident.id}/similar`);
      if (simRes.ok) {
        const simData = await simRes.json();
        setSimilarIncidents(simData);
      }

      const tlRes = await fetch(`/api/incidents/${incident.id}/timeline`);
      if (tlRes.ok) {
        const tlData = await tlRes.json();
        setTimeline(tlData);
      }
    } catch (err) {
      console.error("Failed to fetch incident details", err);
    } finally {
      setLoadingSignals(false);
      setLoadingSimilar(false);
    }
  };

  const handleStateChange = async (newState) => {
    try {
      const res = await fetch(`/api/incidents/${selectedIncident.id}/state`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newState })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setRcaStatus({ message: `Success: State transitioned to ${newState}`, error: false });
      fetchIncidents(); // Refresh UI
      fetchMttr(); // Refresh Analytics if closed

      // Refresh timeline after state change
      const tlRes = await fetch(`/api/incidents/${selectedIncident.id}/timeline`);
      if (tlRes.ok) setTimeline(await tlRes.json());
    } catch (err) {
      setRcaStatus({ message: err.message, error: true });
    }
  };

  const submitRCA = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/incidents/${selectedIncident.id}/rca`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rcaForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      setRcaStatus({ message: 'RCA Submitted Successfully! You can now Close the incident.', error: false });
      // Refresh timeline after RCA submission
      const tlRes = await fetch(`/api/incidents/${selectedIncident.id}/timeline`);
      if (tlRes.ok) setTimeline(await tlRes.json());
    } catch (err) {
      setRcaStatus({ message: err.message, error: true });
    }
  };

  const autoGenerateRCA = async () => {
    setIsGeneratingRca(true);
    setRcaStatus({ message: '✨ Gemini is analyzing telemetry logs...', error: false });
    try {
      const res = await fetch(`/api/incidents/${selectedIncident.id}/auto-rca`, {
        method: 'POST'
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate RCA');
      
      setRcaForm({
        root_cause_category: data.root_cause_category || '',
        fix_applied: data.fix_applied || '',
        prevention_steps: data.prevention_steps || ''
      });
      setRcaStatus({ message: 'AI RCA Generated Successfully!', error: false });
      // Refresh timeline after AI RCA generation
      const tlRes = await fetch(`/api/incidents/${selectedIncident.id}/timeline`);
      if (tlRes.ok) setTimeline(await tlRes.json());
    } catch (err) {
      setRcaStatus({ message: err.message, error: true });
    } finally {
      setIsGeneratingRca(false);
    }
  };

  const getSeverityColor = (sev) => {
    switch (sev) {
      case 'P0': return 'var(--severity-p0)';
      case 'P1': return 'var(--severity-p1)';
      case 'P2': return 'var(--severity-p2)';
      default: return 'var(--severity-p3)';
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'OPEN': return 'var(--status-open)';
      case 'INVESTIGATING': return 'var(--status-investigating)';
      case 'RESOLVED': return 'var(--status-resolved)';
      case 'CLOSED': return 'var(--status-closed)';
      default: return 'var(--text-muted)';
    }
  };

  const formatMttr = (seconds) => {
    if (!seconds || Number(seconds) === 0) return "--";
    const num = Number(seconds);
    const hrs = Math.floor(num / 3600);
    const mins = Math.floor((num % 3600) / 60);
    const secs = Math.floor(num % 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const inputStyle = {
    width: '100%',
    padding: '0.75rem',
    background: 'rgba(0,0,0,0.2)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    color: 'var(--text-main)',
    marginBottom: '1rem',
    fontFamily: 'inherit'
  };

  const btnStyle = {
    padding: '0.5rem 1rem',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: '0.85rem'
  };

  return (
    <main style={{ padding: '3rem 5%', maxWidth: '1400px', margin: '0 auto', display: 'flex', gap: '2rem' }}>
      
      <div style={{ flex: selectedIncident ? '1' : '100%', transition: 'all 0.3s ease' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3rem' }}>
          <div>
            <h1 className="text-gradient" style={{ fontSize: '3rem', fontWeight: 800, letterSpacing: '-1px' }}>
              Mission Control
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem', marginTop: '0.5rem' }}>
              Real-time Incident Management System
            </p>
          </div>
          {!selectedIncident && (
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              
              {/* Incident Stats Bar */}
              <div className="glass-panel" style={{ padding: '0.5rem 1.25rem', display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '1px' }}>TOTAL INCIDENTS</span>
                  <span className="monospace" style={{ fontSize: '1.2rem', color: '#fff', fontWeight: 600 }}>{mttr.total_count}</span>
                </div>
                <div style={{ width: '1px', height: '25px', background: 'var(--border-color)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '1px' }}>ACTIVE</span>
                  <span className="monospace" style={{ fontSize: '1.2rem', color: 'var(--status-open)', fontWeight: 600 }}>
                    {mttr.active_count}
                  </span>
                </div>
                <div style={{ width: '1px', height: '25px', background: 'var(--border-color)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '1px' }}>CLOSED</span>
                  <span className="monospace" style={{ fontSize: '1.2rem', color: 'var(--status-closed)', fontWeight: 600 }}>{mttr.closed_count}</span>
                </div>
                <div style={{ width: '1px', height: '25px', background: 'var(--border-color)' }} />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 800, letterSpacing: '1px' }}>AVG MTTR</span>
                  <span className="monospace" style={{ fontSize: '1.2rem', color: 'var(--accent-purple)', fontWeight: 600 }}>
                    {formatMttr(mttr.avg_mttr_seconds)}
                  </span>
                </div>
              </div>

              <RealtimeGraph 
                history={signalHistory} 
                currentRate={currentRate} 
                totalDropped={droppedSignals} 
              />

              <button 
                onClick={runSimulation}
                className="monospace"
                style={{
                  background: isSimulating ? 'transparent' : '#10b981',
                  color: isSimulating ? '#10b981' : '#000',
                  border: '1px solid #10b981',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '8px',
                  fontWeight: 800,
                  cursor: isSimulating ? 'default' : 'pointer',
                  boxShadow: isSimulating ? 'none' : '0 0 15px rgba(16, 185, 129, 0.4)',
                  transition: 'all 0.3s'
                }}
              >
                {isSimulating ? 'SIMULATING (100 SIGS/SEC)...' : '🔥 RUN CHAOS SIMULATION'}
              </button>
              <div className="glass-panel" style={{ padding: '0.75rem 1.5rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#10b981', boxShadow: '0 0 10px #10b981' }} />
                <span className="monospace" style={{ fontSize: '0.9rem', color: '#10b981' }}>SYSTEM OPERATIONAL</span>
              </div>
            </div>
          )}
        </header>

        {loading && incidents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '5rem', color: 'var(--text-muted)' }}>
            <h2 className="monospace">INITIALIZING TELEMETRY...</h2>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: selectedIncident ? '1fr' : 'repeat(auto-fill, minmax(380px, 1fr))', gap: '1.5rem' }}>
            
            {incidents.length === 0 && !loading && (
              <div className="glass-panel" style={{ gridColumn: '1 / -1', padding: '4rem', textAlign: 'center' }}>
                <h2 style={{ color: 'var(--text-muted)', fontWeight: 400 }}>No active incidents. You are clear for takeoff. 🚀</h2>
              </div>
            )}

            {incidents.map((incident) => (
              <div 
                key={incident.id} 
                onClick={() => openIncident(incident)}
                className="glass-panel" 
                style={{ 
                  padding: '1.5rem', 
                  position: 'relative', 
                  overflow: 'hidden',
                  cursor: 'pointer',
                  border: selectedIncident?.id === incident.id ? `1px solid ${getSeverityColor(incident.severity)}` : '',
                  transform: selectedIncident?.id === incident.id ? 'scale(1.02)' : 'none'
                }}
              >
                <div style={{ 
                  position: 'absolute', top: 0, left: 0, right: 0, height: '4px', 
                  backgroundColor: getSeverityColor(incident.severity) 
                }} />
                
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                      <span 
                        className={incident.severity === 'P0' ? 'pulse-red' : ''}
                        style={{ 
                          backgroundColor: getSeverityColor(incident.severity), 
                          color: '#fff', 
                          padding: '0.2rem 0.6rem', 
                          borderRadius: '4px', 
                          fontSize: '0.8rem', 
                          fontWeight: 800 
                        }}
                      >
                        {incident.severity}
                      </span>
                      <span style={{ 
                        color: getStatusColor(incident.status), 
                        fontSize: '0.85rem', 
                        fontWeight: 600,
                        letterSpacing: '1px'
                      }}>
                        • {incident.status}
                      </span>
                    </div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-main)', wordBreak: 'break-all' }}>
                      {incident.component_id}
                    </h3>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>UUID</span>
                    <span className="monospace" style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
                      {incident.id.split('-')[0]}...{incident.id.split('-')[4]}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Triggered At</span>
                    <span className="monospace" style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
                      {new Date(incident.created_at).toLocaleTimeString([], { hour12: false })}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail Pane */}
      {selectedIncident && (
        <div className="glass-panel" style={{ flex: '1.2', padding: '2rem', display: 'flex', flexDirection: 'column', maxHeight: '85vh', position: 'sticky', top: '3rem', overflowY: 'auto' }}>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
            <div>
              <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: getSeverityColor(selectedIncident.severity) }}>
                {selectedIncident.component_id}
              </h2>
              <p className="monospace" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                ID: {selectedIncident.id}
              </p>
            </div>
            <button 
              onClick={() => setSelectedIncident(null)}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.5rem' }}
            >
              ✕
            </button>
          </div>

          {rcaStatus.message && (
            <div style={{ 
              padding: '1rem', 
              borderRadius: '8px', 
              marginBottom: '1.5rem', 
              backgroundColor: rcaStatus.error ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
              border: `1px solid ${rcaStatus.error ? '#ef4444' : '#10b981'}`,
              color: rcaStatus.error ? '#fca5a5' : '#6ee7b7'
            }}>
              {rcaStatus.message}
            </div>
          )}

          {/* State Machine Actions */}
          <div style={{ marginBottom: '2rem', padding: '1rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <h4 style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>LIFECYCLE ACTIONS</h4>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button 
                onClick={() => handleStateChange('INVESTIGATING')}
                style={{ ...btnStyle, background: 'var(--status-investigating)', color: '#fff', opacity: selectedIncident.status === 'OPEN' ? 1 : 0.4 }}
              >
                Investigate
              </button>
              <button 
                onClick={() => handleStateChange('RESOLVED')}
                style={{ ...btnStyle, background: 'var(--status-resolved)', color: '#fff', opacity: selectedIncident.status === 'INVESTIGATING' ? 1 : 0.4 }}
              >
                Mark Resolved
              </button>
              <button 
                onClick={() => handleStateChange('CLOSED')}
                style={{ ...btnStyle, background: 'var(--status-closed)', color: '#fff', opacity: selectedIncident.status === 'RESOLVED' ? 1 : 0.4 }}
              >
                Close Incident
              </button>
            </div>
          </div>

          {/* Incident Timeline */}
          {timeline.length > 0 && (
            <div style={{ marginBottom: '2rem' }}>
              <h4 style={{ color: 'var(--text-main)', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                Incident Timeline
              </h4>
              <div style={{ position: 'relative', paddingLeft: '1.5rem' }}>
                {/* Vertical line */}
                <div style={{ position: 'absolute', left: '0.45rem', top: '0.5rem', bottom: '0.5rem', width: '2px', background: 'linear-gradient(to bottom, #3b82f6, #8b5cf6, #10b981)' }} />
                {timeline.map((event, i) => {
                  const eventColors = {
                    CREATED: '#3b82f6',
                    STATE_CHANGE: '#f59e0b',
                    AI_RCA_GENERATED: '#8b5cf6',
                    RCA_SUBMITTED: '#10b981',
                    AI_RAG_MATCH: '#06b6d4'
                  };
                  const dotColor = eventColors[event.event_type] || '#6b7280';
                  return (
                    <div key={event.id || i} style={{ position: 'relative', marginBottom: i < timeline.length - 1 ? '1rem' : 0, paddingLeft: '1.25rem' }}>
                      {/* Dot */}
                      <div style={{ 
                        position: 'absolute', left: '-1.15rem', top: '0.35rem', 
                        width: '10px', height: '10px', borderRadius: '50%', 
                        backgroundColor: dotColor, 
                        boxShadow: `0 0 8px ${dotColor}80`
                      }} />
                      <div style={{ 
                        padding: '0.75rem 1rem', 
                        background: 'rgba(0,0,0,0.3)', 
                        borderRadius: '6px', 
                        border: '1px solid var(--border-color)' 
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                          <span style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>{event.description}</span>
                          <span className="monospace" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0, marginLeft: '1rem' }}>
                            {new Date(event.created_at).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </span>
                        </div>
                        <span style={{ fontSize: '0.65rem', color: dotColor, fontWeight: 700, letterSpacing: '0.5px' }}>{event.event_type}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Distributed Trace Dependency Map */}
          <DependencyMap targetComponent={selectedIncident.component_id} />

          {/* AI RAG Resolution */}
          {similarIncidents.length > 0 && (
            <div style={{ marginBottom: '2rem', padding: '1.5rem', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
              <h4 style={{ color: '#60a5fa', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span style={{ fontSize: '1.2rem' }}>🧠</span> AI Incident Resolution (RAG)
              </h4>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                Retrieval-Augmented Generation searched {mttr.closed_count} past closed incidents and found similar historical signatures.
              </p>
              
              {similarIncidents.map((sim, i) => (
                <div key={i} style={{ marginBottom: i < similarIncidents.length - 1 ? '1rem' : 0, padding: '1rem', background: 'rgba(0,0,0,0.3)', borderRadius: '6px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span style={{ color: '#93c5fd', fontSize: '0.85rem', fontWeight: 600 }}>{sim.component_id}</span>
                    <span style={{ color: '#10b981', fontSize: '0.85rem', fontWeight: 800 }}>{sim.sim_score}% Match</span>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: '1.4' }}>
                    <div style={{ marginBottom: '0.25rem' }}><strong>Category:</strong> {sim.root_cause_category}</div>
                    <div><strong>Fix Applied:</strong> <span className="monospace" style={{ color: 'var(--text-muted)' }}>{sim.fix_applied}</span></div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* RCA Form */}
          {selectedIncident.status !== 'CLOSED' && (
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
                <h4 style={{ color: 'var(--text-main)', margin: 0 }}>
                  Root Cause Analysis (RCA)
                </h4>
                <button 
                  onClick={autoGenerateRCA}
                  disabled={isGeneratingRca}
                  style={{ 
                    background: 'linear-gradient(45deg, #8b5cf6, #3b82f6)', 
                    color: '#fff', 
                    border: 'none', 
                    padding: '0.4rem 0.8rem', 
                    borderRadius: '4px', 
                    fontSize: '0.75rem', 
                    fontWeight: 600, 
                    cursor: isGeneratingRca ? 'default' : 'pointer',
                    opacity: isGeneratingRca ? 0.7 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}
                >
                  {isGeneratingRca ? '✨ ANALYZING LOGS...' : '✨ AUTO-GENERATE RCA'}
                </button>
              </div>
              <form onSubmit={submitRCA}>
                <input 
                  required
                  style={inputStyle} 
                  placeholder="Root Cause Category (e.g. Database, Network)"
                  value={rcaForm.root_cause_category}
                  onChange={e => setRcaForm({...rcaForm, root_cause_category: e.target.value})}
                />
                <textarea 
                  required
                  style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} 
                  placeholder="Fix Applied"
                  value={rcaForm.fix_applied}
                  onChange={e => setRcaForm({...rcaForm, fix_applied: e.target.value})}
                />
                <textarea 
                  required
                  style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }} 
                  placeholder="Prevention Steps"
                  value={rcaForm.prevention_steps}
                  onChange={e => setRcaForm({...rcaForm, prevention_steps: e.target.value})}
                />
                <button type="submit" style={{ ...btnStyle, background: 'var(--accent-blue)', color: '#fff', width: '100%', padding: '0.75rem' }}>
                  Submit RCA to Database
                </button>
              </form>
            </div>
          )}

          {/* Raw Telemetry */}
          <h4 style={{ color: 'var(--text-main)', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
            Raw Telemetry (MongoDB)
          </h4>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {loadingSignals ? (
              <p className="monospace" style={{ color: 'var(--text-muted)' }}>Fetching signals from data lake...</p>
            ) : signals.length === 0 ? (
              <p className="monospace" style={{ color: 'var(--text-muted)' }}>No raw signals found.</p>
            ) : (
              signals.map((sig, i) => (
                <div key={i} style={{ background: 'rgba(0,0,0,0.3)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                    <span className="monospace" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {new Date(sig.timestamp).toISOString()}
                    </span>
                  </div>
                  <pre className="monospace" style={{ 
                    fontSize: '0.8rem', 
                    color: 'var(--text-main)', 
                    whiteSpace: 'pre-wrap', 
                    wordBreak: 'break-all',
                    margin: 0
                  }}>
                    {JSON.stringify(sig.payload, null, 2)}
                  </pre>
                </div>
              ))
            )}
          </div>

        </div>
      )}
    </main>
  );
}
