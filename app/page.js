'use client';

import { useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [incidentType, setIncidentType] = useState('');
  const [carA, setCarA] = useState('');
  const [carB, setCarB] = useState('');
  const [stewardNotes, setStewardNotes] = useState('');
  const [manualTitle, setManualTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);        // ← pure JS, no <any>
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch('/api/analyze-intranet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          incidentType,
          carA: carA.trim(),
          carB: carB.trim(),
          stewardNotes,
          manualTitle: manualTitle.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Something went wrong');
      setResult(data);
    } catch (err) {
      setError(err.message || 'Failed to generate verdict');
    } finally {
      setLoading(false);
    }
  };

  // Helper to extract YouTube ID safely
  const getYouTubeId = (url) => {
    if (!url) return '';
    if (url.includes('youtu.be')) return url.split('/').pop()?.split('?')[0] || '';
    if (url.includes('watch?v=')) return url.split('v=')[1]?.split('&')[0] || '';
    return '';
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10 px-4">
      {/* LOGO */}
      <div className="w-full bg-white dark:bg-gray-800 shadow-xl border-b-4 border-blue-600 py-8">
        <div className="max-w-5xl mx-auto px-6 flex flex-col items-center">
          <img
            src="/logo.png"
            alt="TheSimRacingStewards"
            className="h-28 md:h-36 object-contain drop-shadow-2xl mb-4"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling.style.display = 'block';
            }}
          />
          <div className="hidden text-5xl md:text-7xl font-black bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            TheSimRacingStewards
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto mt-10">
        <h1 className="text-4xl font-bold text-center mb-2 text-gray-900 dark:text-white">
          Incident Verdict Tool
        </h1>
        <p className="text-center text-gray-600 dark:text-gray-300 mb-12">
          Professional • Neutral • Precedent-backed
        </p>

        {/* YOUR FORM — unchanged */}
        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl mb-12">
          {/* ... all your existing form fields ... */}
          {/* (kept exactly as you had them) */}
          <div className="grid gap-6">
            {/* ... your inputs ... */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-5 bg-gradient-to-r from-blue-600 to-indigo-700 text-white text-xl font-bold rounded-xl hover:from-blue-700 hover:to-indigo-800 disabled:opacity-50 transition"
            >
              {loading ? 'Generating...' : 'Generate Professional Verdict'}
            </button>
          </div>
        </form>

        {error && (
          <div className="mt-8 p-6 bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-xl">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* SIDE-BY-SIDE LAYOUT */}
        {result && result.verdict && (
          <div className="mt-12 grid grid-cols-1 lg:grid-cols-2 gap-10 xl:gap-16">
            {/* LEFT: Video */}
            {url && (
              <div className="order-2 lg:order-1">
                <div className="sticky top-6 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700">
                  <div className="bg-gradient-to-r from-blue-600 to-indigo-700 text-white px-6 py-3">
                    <h3 className="text-xl font-bold">Submitted Incident Video</h3>
                  </div>
                  <div className="aspect-video">
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${getYouTubeId(url)}`}
                      title="Submitted Incident"
                      className="w-full h-full"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    ></iframe>
                  </div>
                </div>
              </div>
            )}

            {/* RIGHT: Verdict + Precedents */}
            <div className={`order-1 lg:order-2 ${url ? '' : 'lg:col-span-2'}`}>
              {/* Verdict */}
              <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 mb-10">
                <h2 className="text-3xl font-bold mb-6 text-center text-blue-700 dark:text-blue-400">
                  Official Verdict
                </h2>
                {/* your existing verdict content here */}
                <div className="space-y-6 text-lg">
                  <div><strong>Rule:</strong> {result.verdict.rule}</div>
                  <div className="grid grid-cols-2 gap-6">
                    {Object.entries(result.verdict.fault).map(([car, fault]) => (
                      <div key={car} className="text-center p-6 bg-gray-50 dark:bg-gray-700 rounded-xl">
                        <div className="text-2xl font-bold">{car}</div>
                        <div className="text-4xl font-black text-red-600 dark:text-red-400 mt-2">{fault}</div>
                      </div>
                    ))}
                  </div>
                  <div><strong>Car Roles:</strong> {result.verdict.car_identification}</div>
                  <div className="prose prose-lg dark:prose-invert">
                    <p className="whitespace-pre-wrap">{result.verdict.explanation}</p>
                  </div>
                  <div className="mt-8 p-6 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/30 dark:to-orange-900/30 rounded-xl border border-amber-300 dark:border-amber-700">
                    <p className="text-xl font-bold text-amber-900 dark:text-amber-200">
                      {result.verdict.pro_tip}
                    </p>
                  </div>
                  <div className="text-center text-sm text-gray-500">
                    Confidence: <span className="font-bold">{result.verdict.confidence}</span>
                  </div>
                </div>
              </div>

              {/* Precedents */}
              {result.precedents && result.precedents.length > 0 && (
                <div className="p-8 bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-900/20 dark:to-blue-900/20 rounded-2xl shadow-xl border border-green-200 dark:border-green-700">
                  <h3 className="text-2xl font-bold text-green-700 dark:text-green-300 mb-6 text-center">
                    Precedent Cases
                  </h3>
                  {result.precedents.map((p, i) => (
                    <div key={i} className="mb-8 p-6 bg-white dark:bg-gray-800 rounded-xl shadow border">
                      <h4 className="text-xl font-bold mb-2">{p.title}</h4>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        <strong>Ruling:</strong> {p.ruling} | <strong>Fault A:</strong> {p.faultA}%
                      </p>
                      <p className="text-gray-700 dark:text-gray-300 italic mt-2">"{p.reason}"</p>
                      {p.thread && (
                        <a
                          href={p.thread}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block mt-3 text-blue-600 hover:text-blue-800 dark:text-blue-400 font-medium"
                        >
                          View Original Reddit Discussion
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
