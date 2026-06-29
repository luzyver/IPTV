import React, { useState, useEffect, useRef, useMemo } from 'react';
import Hls from 'hls.js';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Settings,
  Search,
  RotateCw,
  Tv,
  Star,
  CheckCircle2,
  AlertTriangle,
  Info,
  Radio
} from 'lucide-react';
import type { Channel, PlayerStats } from './types';

// Palette of premium gradients matching the Acid Grid theme
const LOGO_GRADIENTS = [
  'linear-gradient(135deg, #c6ff00 0%, #a2d200 100%)', // Acid Lime
  'linear-gradient(135deg, #00f0ff 0%, #00bcce 100%)', // Neon Cyan
  'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', // Slate Gray
  'linear-gradient(135deg, #334155 0%, #1e293b 100%)', // Charcoal Slate
  'linear-gradient(135deg, #0f172a 0%, #c6ff00 100%)', // Slate-Lime Mix
  'linear-gradient(135deg, #0f172a 0%, #00f0ff 100%)', // Slate-Cyan Mix
  'linear-gradient(135deg, #111827 0%, #374151 100%)', // Dark Grey
  'linear-gradient(135deg, #00f0ff 0%, #c6ff00 100%)', // Cyan-Lime Gradient
];

function getChannelGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % LOGO_GRADIENTS.length;
  return LOGO_GRADIENTS[index];
}

function getChannelInitials(name: string): string {
  const cleanName = name.replace(/HD|FHD|UHD|US|UK|RO|ES|FR|IT|DE|IN/gi, '').trim();
  const parts = cleanName.split(/\s+/).filter(p => p.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function App() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [favorites, setFavorites] = useState<string[]>([]);
  
  // Player Controls State
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [playerStats, setPlayerStats] = useState<PlayerStats | null>(null);
  const [isLoadingStream, setIsLoadingStream] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // App Refresh State
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const statsIntervalRef = useRef<any>(null);

  // API base URL - dynamic depending on environment
  const API_BASE = window.location.origin;

  // Show toast utility
  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  // Fetch Channels on load
  const loadChannels = async (initial = false) => {
    try {
      const res = await fetch(`${API_BASE}/api/channels`);
      const data = await res.json();
      if (data.success) {
        setChannels(data.channels);
        if (initial && data.channels.length > 0) {
          // Play the first channel by default
          setSelectedChannel(data.channels[0]);
        }
      } else {
        showToast('Gagal memuat daftar channel', 'error');
      }
    } catch (e: any) {
      showToast(`Gagal terhubung ke server: ${e.message}`, 'error');
    }
  };

  useEffect(() => {
    // Load favorites from local storage
    const storedFavs = localStorage.getItem('iptv_favorites');
    if (storedFavs) {
      setFavorites(JSON.parse(storedFavs));
    }
    loadChannels(true);

    // Fullscreen event listener
    const onFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    };
  }, []);

  // Trigger refresh of scraper script
  const handleRefreshPlaylist = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    showToast('Sedang memperbarui playlist dari server...', 'info');

    try {
      const res = await fetch(`${API_BASE}/api/refresh`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setChannels(data.channels);
        showToast(`Playlist berhasil diperbarui! (${data.count} channel)`, 'success');
      } else {
        showToast(`Gagal memperbarui playlist: ${data.error}`, 'error');
      }
    } catch (e: any) {
      showToast(`Gagal memperbarui playlist: ${e.message}`, 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Toggle favorite channel
  const toggleFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid playing the channel when clicking star
    let updated;
    if (favorites.includes(id)) {
      updated = favorites.filter(fId => fId !== id);
      showToast('Dihapus dari Favorit', 'info');
    } else {
      updated = [...favorites, id];
      showToast('Ditambahkan ke Favorit', 'success');
    }
    setFavorites(updated);
    localStorage.setItem('iptv_favorites', JSON.stringify(updated));
  };

  // Categories computed dynamically
  const categories = useMemo(() => {
    const list = new Set<string>();
    channels.forEach(ch => {
      if (ch.group) list.add(ch.group);
    });
    return ['All', 'Favorites', ...Array.from(list)];
  }, [channels]);

  // Filtered channels
  const filteredChannels = useMemo(() => {
    return channels.filter(ch => {
      const matchesSearch = ch.name.toLowerCase().includes(searchQuery.toLowerCase());
      if (!matchesSearch) return false;

      if (selectedCategory === 'All') return true;
      if (selectedCategory === 'Favorites') return favorites.includes(ch.id);
      return ch.group === selectedCategory;
    });
  }, [channels, searchQuery, selectedCategory, favorites]);

  // HLS Stream Setup
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedChannel) return;

    // Reset player state
    setIsLoadingStream(true);
    setStreamError(null);
    setPlayerStats(null);
    setIsPlaying(false);

    if (statsIntervalRef.current) {
      clearInterval(statsIntervalRef.current);
    }

    // Build the proxy stream URL
    // Format: /api/proxy?url=<encoded_url>&ua=<encoded_ua>&referer=<encoded_referer>
    const proxiedUrl = `${API_BASE}/api/proxy?url=${encodeURIComponent(selectedChannel.url)}&ua=${encodeURIComponent(selectedChannel.userAgent || '')}&referer=${encodeURIComponent(selectedChannel.referer || '')}`;

    if (Hls.isSupported()) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
      }

      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 30,
        maxBufferSize: 30 * 1000 * 1000, // 30MB
      });

      hlsRef.current = hls;
      hls.loadSource(proxiedUrl);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        setIsLoadingStream(false);
        video.play()
          .then(() => setIsPlaying(true))
          .catch(() => setIsPlaying(false));
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error('HLS error:', data);
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              setStreamError('Gagal memuat stream. Masalah koneksi server.');
              setIsLoadingStream(false);
              hls.destroy();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setStreamError('Gagal memutar stream HLS.');
              setIsLoadingStream(false);
              hls.destroy();
              break;
          }
        }
      });

      // Poll performance stats periodically
      statsIntervalRef.current = setInterval(() => {
        if (!hls.levels || hls.levels.length === 0) return;
        
        const activeLevelIndex = hls.currentLevel;
        if (activeLevelIndex === -1) return;

        const level = hls.levels[activeLevelIndex];
        const videoBuffer = video.buffered;
        let bufferLength = 0;
        
        if (videoBuffer.length > 0) {
          for (let i = 0; i < videoBuffer.length; i++) {
            if (video.currentTime >= videoBuffer.start(i) && video.currentTime <= videoBuffer.end(i)) {
              bufferLength = videoBuffer.end(i) - video.currentTime;
              break;
            }
          }
        }

        setPlayerStats({
          resolution: level.width && level.height ? `${level.width}x${level.height}` : 'Auto (Mencari...)',
          bandwidth: level.bitrate ? `${(level.bitrate / 1000000).toFixed(2)} Mbps` : 'N/A',
          bufferLength: Math.round(bufferLength),
          latency: hls.latency ? `${hls.latency.toFixed(1)}s` : 'Low Latency Live'
        });
      }, 1000);

    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Apple device support (Safari, iOS)
      video.src = proxiedUrl;
      video.addEventListener('loadedmetadata', () => {
        setIsLoadingStream(false);
        video.play()
          .then(() => setIsPlaying(true))
          .catch(() => setIsPlaying(false));
      });
      video.addEventListener('error', () => {
        setStreamError('Format video tidak didukung oleh browser Anda.');
        setIsLoadingStream(false);
      });
    } else {
      setStreamError('Browser Anda tidak mendukung pemutaran HLS (.m3u8).');
      setIsLoadingStream(false);
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (statsIntervalRef.current) {
        clearInterval(statsIntervalRef.current);
      }
    };
  }, [selectedChannel]);

  // Video Actions
  const handlePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    
    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play()
        .then(() => setIsPlaying(true))
        .catch(err => console.error(err));
    }
  };

  const handleMuteToggle = () => {
    const video = videoRef.current;
    if (!video) return;

    const newMuteState = !isMuted;
    video.muted = newMuteState;
    setIsMuted(newMuteState);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const newVolume = parseFloat(e.target.value);
    video.volume = newVolume;
    setVolume(newVolume);
    if (newVolume > 0 && isMuted) {
      video.muted = false;
      setIsMuted(false);
    } else if (newVolume === 0 && !isMuted) {
      video.muted = true;
      setIsMuted(true);
    }
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen().catch(err => {
        showToast(`Gagal Fullscreen: ${err.message}`, 'error');
      });
    } else {
      document.exitFullscreen();
    }
  };

  const reloadStream = () => {
    if (!selectedChannel) return;
    const temp = selectedChannel;
    setSelectedChannel(null);
    setTimeout(() => {
      setSelectedChannel(temp);
      showToast('Memuat ulang aliran stream...', 'info');
    }, 100);
  };

  return (
    <div className="app-container">
      {/* 1. Sidebar - Left Panel */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <Tv size={24} className="gradient-text" style={{ strokeWidth: 3 }} />
          <h1>LZVR<span className="gradient-text">IPTV</span></h1>
        </div>

        {/* Categories navigation */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          <h4 style={{ padding: '12px 24px 8px', fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.05em' }}>
            Kategori
          </h4>
          <nav className="category-list">
            {categories.map(cat => {
              const count = channels.filter(ch => {
                if (cat === 'All') return true;
                if (cat === 'Favorites') return favorites.includes(ch.id);
                return ch.group === cat;
              }).length;

              return (
                <div
                  key={cat}
                  className={`category-item ${selectedCategory === cat ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {cat === 'Favorites' ? <Star size={14} style={{ fill: selectedCategory === 'Favorites' ? 'var(--text-active)' : 'none' }} /> : <Radio size={14} />}
                    {cat === 'All' ? 'Semua Channel' : cat === 'Favorites' ? 'Favorit' : cat}
                  </span>
                  <span className="category-count">{count}</span>
                </div>
              );
            })}
          </nav>
        </div>

        {/* Action / Scraper Refresh in Sidebar footer */}
        <div className="sidebar-footer">
          <button
            className={`refresh-button ${isRefreshing ? 'loading' : ''}`}
            onClick={handleRefreshPlaylist}
            disabled={isRefreshing}
          >
            <RotateCw size={16} />
            {isRefreshing ? 'Memperbarui...' : 'Perbarui Playlist'}
          </button>
        </div>
      </aside>

      {/* 2. Main Area - Player & Selection Grid */}
      <main className="main-content">
        <header className="dashboard-header">
          <div className="header-title-section">
            <h2>LZVR IPTV Dashboard</h2>
            <p>Tonton siaran TV berkualitas tinggi tanpa hambatan</p>
          </div>
          <div className="stats-badges">
            <div className="stat-badge live">Live Streams</div>
            <div className="stat-badge">{channels.length} Saluran</div>
          </div>
        </header>

        {/* Hero Video Player */}
        <section className="player-section">
          {selectedChannel ? (
            <div className="video-container" ref={containerRef}>
              <video
                ref={videoRef}
                className="video-player"
                onClick={handlePlayPause}
                playsInline
              />

              {/* Watermark / Logo Overlay */}
              <div className="player-watermark">
                <div className="watermark-badge">
                  <Radio size={12} className="gradient-text" style={{ animation: 'pulse 1.5s infinite' }} />
                  {selectedChannel.name}
                </div>
              </div>

              {/* Loading/Error State Overlays */}
              {isLoadingStream && (
                <div className="player-state-overlay">
                  <div className="spinner"></div>
                  <p>Menghubungkan ke saluran dan buffering segmen media...</p>
                </div>
              )}

              {streamError && (
                <div className="player-state-overlay">
                  <AlertTriangle size={48} style={{ color: 'var(--error)' }} />
                  <h3>Gagal Memutar Saluran</h3>
                  <p>{streamError}</p>
                  <button className="refresh-button" style={{ width: 'auto', padding: '8px 16px', marginTop: '12px' }} onClick={reloadStream}>
                    <RotateCw size={14} style={{ marginRight: '6px' }} /> Coba Lagi
                  </button>
                </div>
              )}

              {/* HUD Stats Overlay */}
              {showStats && playerStats && (
                <div className="player-stats-hud">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '6px' }}>
                    <Info size={12} style={{ color: 'var(--accent-indigo)' }} />
                    <span style={{ fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase' }}>Stats Aliran Stream</span>
                  </div>
                  <div className="hud-row">
                    <span className="hud-label">Resolusi</span>
                    <span className="hud-value">{playerStats.resolution}</span>
                  </div>
                  <div className="hud-row">
                    <span className="hud-label">Bitrate</span>
                    <span className="hud-value">{playerStats.bandwidth}</span>
                  </div>
                  <div className="hud-row">
                    <span className="hud-label">Penyangga (Buffer)</span>
                    <span className="hud-value">{playerStats.bufferLength}s</span>
                  </div>
                  <div className="hud-row">
                    <span className="hud-label">Latensi</span>
                    <span className="hud-value">{playerStats.latency}</span>
                  </div>
                </div>
              )}

              {/* Custom Controller Overlay */}
              <div className="custom-controls-overlay">
                {/* Live stream timeline (non-interactive indicator) */}
                <div className="progress-bar-container">
                  <div className="progress-bar-fill" style={{ width: isPlaying ? '100%' : '0%' }}></div>
                </div>

                <div className="controls-row">
                  <div className="controls-left">
                    <button className="control-btn" onClick={handlePlayPause}>
                      {isPlaying ? <Pause /> : <Play />}
                    </button>

                    <div className="volume-wrapper">
                      <button className="control-btn" onClick={handleMuteToggle}>
                        {isMuted ? <VolumeX /> : <Volume2 />}
                      </button>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={volume}
                        onChange={handleVolumeChange}
                        className="volume-slider"
                      />
                    </div>

                    <div className="live-indicator">
                      <span>Live</span>
                    </div>
                  </div>

                  <div className="controls-right">
                    <button className="control-btn" onClick={() => setShowStats(!showStats)} title="Stream stats">
                      <Settings style={{ color: showStats ? 'var(--text-active)' : 'inherit' }} />
                    </button>
                    <button className="control-btn" onClick={toggleFullscreen} title="Fullscreen">
                      {isFullscreen ? <Minimize2 /> : <Maximize2 />}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="video-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px', background: 'radial-gradient(circle, #131522 0%, #08090f 100%)' }}>
              <Tv size={64} style={{ color: 'var(--text-muted)', opacity: 0.3 }} />
              <p style={{ color: 'var(--text-secondary)' }}>Pilih saluran di sebelah kanan untuk mulai memutar siaran</p>
            </div>
          )}
        </section>
      </main>

      {/* 3. Channels List - Right Sidebar */}
      <aside className="channels-panel">
        <div className="channels-header">
          <h3>Saluran</h3>
          <span className="category-count">{filteredChannels.length}</span>
        </div>
        
        {/* Search Bar */}
        <div className="search-container" style={{ borderBottom: '1px solid var(--border-color)', padding: '12px 20px' }}>
          <div className="search-input-wrapper">
            <Search className="search-icon" size={16} />
            <input
              type="text"
              placeholder="Cari saluran..."
              className="search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <div className="channels-list-container">
          {filteredChannels.length > 0 ? (
            filteredChannels.map(ch => {
              const isActive = selectedChannel?.id === ch.id;
              const isFavorite = favorites.includes(ch.id);
              
              return (
                <div
                  key={ch.id}
                  className={`channel-card ${isActive ? 'active' : ''}`}
                  onClick={() => setSelectedChannel(ch)}
                >
                  <div className="card-content-wrapper">
                    {/* Logo container with unique gradient */}
                    <div
                      className="channel-logo-placeholder"
                      style={{ background: getChannelGradient(ch.name) }}
                    >
                      {getChannelInitials(ch.name)}
                    </div>
                    
                    <div className="channel-info">
                      <span className="channel-name" title={ch.name}>{ch.name}</span>
                      <span className="channel-group-tag">{ch.group}</span>
                    </div>

                    <button
                      className={`fav-btn ${isFavorite ? 'is-favorite' : ''}`}
                      onClick={(e) => toggleFavorite(ch.id, e)}
                      title={isFavorite ? 'Hapus dari favorit' : 'Tambah ke favorit'}
                    >
                      <Star style={{ fill: isFavorite ? 'currentColor' : 'none' }} />
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 16px', border: '1px dashed var(--border-color)', borderRadius: '8px', color: 'var(--text-muted)', textAlign: 'center' }}>
              <Radio size={24} style={{ marginBottom: '8px', opacity: 0.5 }} />
              <p style={{ fontSize: '0.8rem' }}>Tidak ada saluran yang cocok dengan kriteria filter</p>
            </div>
          )}
        </div>
      </aside>


      {/* 3. Toast Notifications Popup */}
      {toast && (
        <div className="toast-notification">
          {toast.type === 'success' ? (
            <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />
          ) : toast.type === 'error' ? (
            <AlertTriangle size={18} style={{ color: 'var(--error)' }} />
          ) : (
            <Info size={18} style={{ color: 'var(--accent-indigo)' }} />
          )}
          <span className="toast-content">{toast.message}</span>
        </div>
      )}
    </div>
  );
}
