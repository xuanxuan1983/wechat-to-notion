'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link2, CheckCircle, AlertCircle, Loader2, ArrowRight, ExternalLink } from 'lucide-react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ title: string, pageId: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;

    setStatus('loading');
    setMessage('Analyzing URL...');
    setResult(null);

    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        body: JSON.stringify({ url }),
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Failed to process request');

      setResult(data);
      setStatus('success');
    } catch (err: any) {
      setStatus('error');
      setMessage(err.message);
    }
  };

  return (
    <main className="container">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="glass-card"
      >
        <div className="text-center mb-10">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="flex justify-center mb-6"
          >
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-green-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-green-500/20">
              <Link2 className="w-10 h-10 text-white" />
            </div>
          </motion.div>
          <h1 className="hero-title">WeChat to Notion</h1>
          <p className="hero-subtitle">Instantly save articles to your knowledge base</p>
        </div>

        <form onSubmit={handleSubmit} className="max-w-md mx-auto">
          <div className="input-group">
            <input
              type="url"
              placeholder="Paste WeChat article URL here..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="glass-input"
              required
            />
          </div>

          <button
            type="submit"
            className="btn-primary flex items-center justify-center gap-2"
            disabled={status === 'loading'}
          >
            {status === 'loading' ? (
              <>
                <Loader2 className="animate-spin w-5 h-5" />
                <span>{message || 'Processing...'}</span>
              </>
            ) : (
              <>
                <span>Save to Notion</span>
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>

        <AnimatePresence>
          {status === 'error' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="status-message status-error mt-6"
            >
              <AlertCircle className="w-5 h-5" />
              <span>{message}</span>
            </motion.div>
          )}

          {status === 'success' && result && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-8 p-6 rounded-xl bg-gradient-to-br from-white/5 to-white/10 border border-white/10 text-center"
            >
              <div className="flex justify-center mb-4">
                <CheckCircle className="w-12 h-12 text-green-400" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">{result.title}</h3>
              <p className="text-gray-400 mb-6 text-sm">Successfully saved to your database</p>

              <a
                href={`https://notion.so/${result.pageId.replace(/-/g, '')}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 text-primary hover:text-white transition-colors"
                style={{ color: '#a78bfa' }}
              >
                <span>View in Notion</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-8 text-center text-xs text-gray-500">
          <p>Make sure to configure your .env.local with NOTION_API_KEY and DATABASE_ID</p>
        </div>
      </motion.div>
    </main>
  );
}
