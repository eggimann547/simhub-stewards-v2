'use client';

import { useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [incidentType, setIncidentType] = useState('');
  const [carA, setCarA] = useState('');
  const [carB, setCarB] = useState('');
  const [stewardNotes, setStewardNotes] = useState('');
  const [overrideFaultA, setOverrideFaultA] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [thumbnail, setThumbnail] = useState('');
  const [matches, setMatches] = useState([]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setResult(null);
    setThumbnail('');
    setLoading(true);
    setMatches([]);

    try {
      const videoId = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/)?.[1];
      if (videoId) setThumbnail(`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`);

      const payload = {
        url,
        incidentType,
        carA: carA.trim(),
        carB: carB.trim(),
        stewardNotes: stewardNotes.trim(),
      };

      if (overrideFaultA.trim() !== '') {
        payload.overrideFaultA = parseInt(overrideFaultA);
      }

      const res = await fetch('/api/analyze-intranet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');

      setResult(data.verdict);
      setMatches(data.matches || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      {/* LOGO BANNER */}
      <div className="w-full bg-white dark:bg-gray-800 shadow-xl border-b-4 border-blue-600">
        <div className="w-full px-6 py-8 flex items-center justify-center">
          <img
            src="/logo.png"
            alt="The Sim Racing Stewards"
            className="w-full max-w-5xl h-auto object-contain drop-shadow-lg"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling.style.display = 'flex';
            }}
          />
          <div className="hidden w-full max-w-5xl h-40 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl items-center justify-center text-white font-bold text-4xl shadow-2xl">
            The Sim Racing Stewards
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-6 md:p-12 space-y-10">
        <div className="text-center">
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Sim Racing Steward AI — Human-in-the-Loop
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 mt-2">
            Real stewards + 28k precedents + Grok-3
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl mx-auto">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste YouTube incident link..."
            required
            className="w-full p-5 border-2 border-gray-300 dark:border-gray-600 rounded-xl focus:ring-4 focus:ring-blue-500 text-lg"
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Incident Type <span className="text-red-500">(required)</span>
            </label>
            <select
              value={incidentType}
              onChange={(e) => setIncidentType(e.target.value)}
              required
              className="w-full p-5 border-2 border-gray-300 dark:border-gray-600 rounded-xl focus:ring-4 focus:ring-blue-500 text-lg bg-white dark:bg-gray-800"
            >
              <option value="">— Choose type —</option>
              <option>Divebomb / Late lunge</option>
              <option>Weave / Block / Defending move</option>
              <option>Unsafe rejoin</option>
              <option>Vortex exit / Draft lift-off</option>
              <option>Netcode / Lag / Teleport</option>
              <option>Used as a barrier / Squeeze</option>
              <option>Pit-lane incident</option>
              <option>Start-line chaos / T1 pile-up</option>
              <option>Intentional wreck / Revenge</option>
              <option>Racing incident (no fault)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-red-600 dark:text-red-400 mb-2">
                Car A (usually causing contact)
              </label>
              <input
                type="text"
                value={carA}
                onChange={(e) => setCarA(e.target.value)}
                placeholder="Red Porsche #24, etc."
                className="w-full p-4 border-2 border-red-300 dark:border-red-700 rounded-xl focus:ring-4 focus:ring-red-500 bg-red-50 dark:bg-red-900/20"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-green-600 dark:text-green-400 mb-2">
                Car B (usually hit)
              </label>
              <input
                type="text"
                value={carB}
                onChange={(e) => setCarB(e.target.value)}
                placeholder="Blue Ferrari #8, etc."
                className="w-full p-4 border-2 border-green-300 dark:border-green-700 rounded-xl focus:ring-4 focus:ring-green-500 bg-green-50 dark:bg-green-900/20"
              />
            </div>
          </div>

          {/* Steward Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Steward Notes <span className="text-gray-500">(drives the verdict)</span>
            </label>
            <textarea
              value={stewardNotes}
              onChange={(e) => setStewardNotes(e.target.value)}
              rows={5}
              placeholder="e.g. Car A braked 18 m late, had less than 30% overlap at apex..."
              className="w-full p-5 border-2 border-gray-300 dark:border-gray-600 rounded-xl focus:ring-4 focus:ring-blue-500 text-lg resize-none"
            />
          </div>

          {/* Override fault */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Override Fault % on Car A <span className="text-gray-500">(optional)</span>
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={overrideFaultA}
              onChange={(e) => setOverrideFaultA(e.target.value)}
              placeholder="e.g. 92"
              className="w-full p-5 border-2 border-amber-400 dark:border-amber-600 rounded-xl focus:ring-4 focus:ring-amber-500 text-lg bg-amber-50 dark:bg-amber-900/20"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !incidentType}
            className="w-full p-5 bg-gradient-to-r from-blue-600 to-purple-700 hover:from-blue-700 text-white font-bold text-lg rounded-xl shadow-lg transition-all disabled:opacity-50"
          >
            {loading ? 'Generating Verdict...' : 'Generate Professional Verdict'}
          </button>
        </form>

        {/* RESULTS */}
        <div className="flex flex-col lg:flex-row gap-8">
          {thumbnail && (
            <div className="lg:w-1/2">
              <img src={thumbnail} alt="Thumbnail" className="w-full rounded-2xl shadow-2xl border border-gray-200" />
            </div>
          )}

          <div className="lg:w-full lg:max-w-2xl space-y-6">
            {error && (
              <div className="p-6 bg-red-100 dark:bg-red-900/30 border-2 border-red-400 rounded-2xl text-red-800 dark:text-red-200">
                {error}
              </div>
            )}

            {result && (
              <div className="p-8 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-900 rounded-2xl shadow-2xl border border-blue-200 dark:border-blue-700">
                <h2 className="text-2xl font-bold text-blue-700 dark:text-blue-300 mb-6">Official Verdict</h2>
                <div className="space-y-6 text-gray-800 dark:text-gray-200">
                  <div>
                    <strong className="text-xl text-blue-600 dark:text-blue-400 block mb-2">Rule</strong>
                    <p className="text-lg">{result.rule}</p>
                  </div>

                  <div>
                    <strong className="text-xl text-blue-600 dark:text-blue-400 block mb-2">Car Roles</strong>
                    <p className="text-base italic p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl font-semibold">
                      {result.car_identification}
                    </p>
                  </div>

                  <div>
                    <strong className="text-xl text-blue-600 dark:text-blue-400 block mb-2">Confidence</strong>
                    <span
                      className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold ${
                        result.confidence.includes('Override') || result.confidence.includes('High')
                          ? 'bg-green-100 text-green-800'
                          : result.confidence === 'Medium'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {result.confidence}
                      {result.confidence !== 'Human Override' && ` (${matches.length}/5 matches)`}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 p-5 bg-gradient-to-r from-red-50 to-green-50 dark:from-red-900/20 dark:to-green-900/20 rounded-xl">
                    <div className="text-center">
                      <strong className="text-lg text-red-600 dark:text-red-400">
                        Car A {carA && `(${carA})`}
                      </strong>
                      <span className="text-4xl font-bold block">
                        {Object.entries(result.fault).find(([k]) => k.includes('Car A'))?.[1] || '—'}
                      </span>
                    </div>
                    <div className="text-center">
                      <strong className="text-lg text-green-600 dark:text-green-400">
                        Car B {carB && `(${carB})`}
                      </strong>
                      <span className="text-4xl font-bold block">
                        {Object.entries(result.fault).find(([k]) => k.includes('Car B'))?.[1] || '—'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-inner">
                    <strong className="text-xl text-blue-600 dark:text-blue-400 block mb-4">Explanation</strong>
                    <p className="text-base leading-relaxed whitespace-pre-line">{result.explanation}</p>
                    <p className="mt-6 italic text-lg font-semibold text-blue-700 dark:text-blue-300">
                      Pro Tip: {result.pro_tip}
                    </p>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        const text = `[VERDICT]\n${result.car_identification}\nFault: A ${Object.entries(result.fault).find(([k]) => k.includes('Car A'))?.[1]} / B ${Object.entries(result.fault).find(([k]) => k.includes('Car B'))?.[1]}\n\n${result.explanation}\n\nTip: ${result.pro_tip}`;
                        navigator.clipboard.writeText(text);
                        alert('Copied to clipboard!');
                      }}
                      className="flex-1 p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold"
                    >
                      Copy Full Verdict
                    </button>
                    <button
                      onClick={() => {
                        const short = `A ${Object.entries(result.fault).find(([k]) => k.includes('Car A'))?.[1]} / B ${Object.entries(result.fault).find(([k]) => k.includes('Car B'))?.[1]}`;
                        navigator.clipboard.writeText(short);
                        alert('Short version copied!');
                      }}
                      className="flex-1 p-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold"
                    >
                      Copy Short
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
