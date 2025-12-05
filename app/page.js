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
  const [result, setResult] = useState(null);
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-10 px-4">
      {/* LOGO HEADER */}
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

      <div className="max-w-4xl mx-auto mt-10">
        <h1 className="text-4xl font-bold text-center mb-2 text-gray-900 dark:text-white">
          Incident Verdict Tool
        </h1>
        <p className="text-center text-gray-600 dark:text-gray-300 mb-10">
          Professional, neutral, precedent-backed incident verdicts
        </p>

        <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-xl">
          <div className="grid gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">Video URL or Reddit Post (optional)</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://youtu.be/..."
                className="w-full p-4 border rounded-xl dark:bg-gray-700 dark:border-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Manual Title (if no video)</label>
              <input
                type="text"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                placeholder="e.g. Vortex of Danger at T1"
                className="w-full p-4 border rounded-xl dark:bg-gray-700 dark:border-gray-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Incident Type *</label>
              <select
                value={incidentType}
                onChange={(e) => setIncidentType(e.target.value)}
                required
                className="w-full p-5 border-2 border-gray-300 dark:border-gray-600 rounded-xl focus:ring-4 focus:ring-blue-500 text-lg bg-white dark:bg-gray-800"
              >
                <option value="">— Choose incident type —</option>
                <option>Divebomb / Late lunge</option>
                <option>Weave / Block / Defending move</option>
                <option>Unsafe rejoin</option>
                <option>Vortex of Danger</option>
                <option>Netcode / Lag / Teleport</option>
                <option>Used as a barrier / Squeeze</option>
                <option>Pit-lane incident</option>
                <option>Start-line chaos / T1 pile-up</option>
                <option>Intentional wreck / Revenge</option>
                <option>Racing incident (no fault)</option>
                <option>Crowd-strike / Accordion effect</option>
                <option>Blocking while being lapped</option>
                <option>Blue-flag violation / Ignoring blue flags</option>
                <option>Brake test</option>
                <option>Brake check</option>
                <option>Cutting the track / Track limits abuse</option>
                <option>False start / Jump start</option>
                <option>Illegal overtake under SC/VSC/FCY</option>
                <option>Move under braking</option>
                <option>Over-aggressive defense (2+ moves)</option>
                <option>Punt / Rear-end under braking</option>
                <option>Re-entry after off-track (gaining advantage)</option>
                <option>Side-by-side contact mid-corner</option>
                <option>Track rejoin blocking racing line</option>
                <option>Unsportsmanlike conduct / Chat abuse</option>
                <option>Wrong way / Ghosting violation</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Car A (e.g. Red/White Ferrari)</label>
                <input
                  type="text"
                  value={carA}
                  onChange={(e) => setCarA(e.target.value)}
                  placeholder="Car A description"
                  className="w-full p-4 border rounded-xl dark:bg-gray-700"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2">Car B</label>
                <input
                  type="text"
                  value={carB}
                  onChange={(e) => setCarB(e.target.value)}
                  placeholder="Car B description"
                  className="w-full p-4 border rounded-xl dark:bg-gray-700"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Steward Notes (optional but helps accuracy)</label>
              <textarea
                value={stewardNotes}
                onChange={(e) => setStewardNotes(e.target.value)}
                rows={4}
                placeholder="e.g.g. Car A dove into the inside late, Car B turned in normally..."
                className="w-full p-4 border rounded-xl dark:bg-gray-700"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-5 bg-gradient-to-r from-blue-600 to-indigo-700 text-white text-xl font-bold rounded-xl hover:from-blue-700 hover:to-indigo-800 disabled:opacity-50 transition"
            >
              {loading ? 'Generating Professional Verdict...' : 'Generate Professional Verdict'}
            </button>
          </div>
        </form>

        {/* Error & Results — unchanged from your working version */}
        {error && (
          <div className="mt-8 p-6 bg-red-50 dark:bg-red-900/30 border border-red-300 dark:border-red-700 rounded-xl">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {result && result.verdict && (
          <div className="mt-12 space-y-8">
            {/* Main Verdict */}
            <div className="bg-white dark:bg-gray-800 p-8 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700">
              <h2 className="text-3xl font-bold mb-6 text-center text-blue-700 dark:text-blue-400">
                Official Verdict
              </h2>
              <div className="space-y-6 text-lg">
                <div><strong>Rule:</strong> {result.verdict.rule}</div>
                <div className="grid grid-cols-2 gap-6">
                  {Object.entries(result.verdict.fault).map(([car, fault]) => (
                    <div key={car} className="text-center p-6 bg-gray-50 dark:bg-gray-700 rounded-xl">
                      <div className="text-2xl font-bold text-gray-900 dark:text-white">{car}</div>
                      <div className="text-4xl font-black text-red-600 dark:text-red-400 mt-2">{fault}</div>
                    </div>
                  ))}
                </div>
                <div><strong>Car Roles:</strong> {result.verdict.car_identification}</div>
                <div className="prose prose-lg dark:prose-invert max-w-none">
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

            {/* Precedent Cases */}
            {result.precedents && result.precedents.length > 0 && (
              <div className="mt-12 p-8 bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-900/20 dark:to-blue-900/20 rounded-2xl shadow-xl border border-green-200 dark:border-green-700">
                <h3 className="text-2xl font-bold text-green-700 dark:text-green-300 mb-6 text-center">
                  Precedent Cases (Real Past Incidents)
                </h3>
               {p.thread && (
              <div className="mb-6 -mx-6 -mt-6 rounded-t-xl overflow-hidden border-b-4 border-gray-300 dark:border-gray-600">
              <iframe
              src={p.thread}
              title={`Original Reddit Thread — ${p.title}`}
              className="w-full h-96"
              frameBorder="0"
              allowFullScreen
              loading="lazy"
              ></iframe>
              </div>
            )}
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
        )}
      </div>
    </div>
  );
}
