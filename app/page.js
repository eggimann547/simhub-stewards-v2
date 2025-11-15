'use client';
import { useState } from 'react';

export default function Home() {
  const [url, setUrl] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [thumbnail, setThumbnail] = useState('');
  const [matches, setMatches] = useState([]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setResult(null); setThumbnail(''); setLoading(true); setMatches([]);

    try {
      const videoId = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11})/)?.[1];
      if (videoId) setThumbnail(`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`);

      const res = await fetch('/api/analyze-intranet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
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
      {/* FULL-WIDTH LOGO BANNER */}
      <div className="w-full bg-white dark:bg-gray-800 shadow-xl border-b-4 border-blue-600">
        <div className="w-full px-6 py-8 flex items-center justify-center">
          <img 
            src="/logo.png" 
            alt="The Sim Racing Stewards" 
            className="w-full max-w-5xl h-auto object-contain drop-shadow-lg"
            onError={(e) => {
              e.target.style.display = 'none';
              e.target.nextSibling.style.display = 'flex';
            }}
          />
          <div 
            className="hidden w-full max-w-5xl h-40 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl items-center justify-center text-white font-bold text-4xl shadow-2xl"
            style={{ display: 'none' }}
          >
            The Sim Racing Stewards
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div className="max-w-6xl mx-auto p-6 md:p-12 space-y-10">
        <div className="text-center">
          <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Sim Racing Steward AI - V2
          </h1>
          <p className="text-lg text-gray-600 dark:text-gray-300 mt-2">
            Private Moderator Tool • Grok-3 + 28k Incident Dataset
          </p>
        </div>

        {/* FORM */}
        <form onSubmit={handleSubmit} className="space-y-4 max-w-2xl mx-auto">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste YouTube incident link..."
            className="w-full p-5 border-2 border-gray-300 dark:border-gray-600 rounded-xl focus:ring-4 focus:ring-blue-500 focus:border-transparent text-lg"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full p-5 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 text-white font-bold text-lg rounded-xl shadow-lg transition-all duration-300 disabled:opacity-50"
          >
            {loading ? 'Analyzing...' : 'Analyze Incident'}
          </button>
        </form>

        {/* RESULTS */}
        <div className="flex flex-col lg:flex-row gap-8">
          {thumbnail && (
            <div className="lg:w-1/2">
              <img src={thumbnail} alt="Video Thumbnail" className="w-full rounded-2xl shadow-2xl border border-gray-200" />
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
                <h2 className="text-2xl font-bold text-blue-700 dark:text-blue-300 mb-6">AI Verdict</h2>
                <div className="space-y-6 text-gray-800 dark:text-gray-200">

                  {/* RULE */}
                  <div>
                    <strong className="text-xl text-blue-600 dark:text-blue-400 block mb-2">Rule Violated</strong>
                    <p className="text-lg font-medium leading-relaxed">{result.rule}</p>
                  </div>

                  {/* CAR ROLES */}
                  <div>
                    <strong className="text-xl text-blue-600 dark:text-blue-400 block mb-2">Car Roles</strong>
                    <p className="text-base italic p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-xl">{result.car_identification}</p>
                  </div>

                  {/* CONFIDENCE */}
                  <div>
                    <strong className="text-xl text-blue-600 dark:text-blue-400 block mb-2">Confidence</strong>
                    <span className={`inline-block px-4 py-1.5 rounded-full text-sm font-bold ${
                      result.confidence === 'High' ? 'bg-green-100 text-green-800' :
                      result.confidence === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {result.confidence} ({matches.length}/5 matches)
                    </span>
                  </div>

                  {/* FAULT */}
                  <div className="grid grid-cols-2 gap-4 p-5 bg-gradient-to-r from-red-50 to-green-50 dark:from-red-900/20 dark:to-green-900/20 rounded-xl">
                    <div>
                      <strong className="text-lg text-red-600 dark:text-red-400">Overtaker (Car A)</strong>
                      <span className="text-3xl font-bold block">{result.fault?.['Car A']}</span>
                    </div>
                    <div>
                      <strong className="text-lg text-green-600 dark:text-green-400">Defender (Car B)</strong>
                      <span className="text-3xl font-bold block">{result.fault?.['Car B']}</span>
                    </div>
                  </div>

                  {/* ACTIONABLE ANALYSIS */}
                  <div className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-inner space-y-6">
                    <strong className="text-xl text-blue-600 dark:text-blue-400 block mb-4">What Happened & How to Improve</strong>

                    {/* INCIDENT SUMMARY */}
                    <div>
                      <h4 className="font-bold text-gray-700 dark:text-gray-300 mb-2">Incident Summary</h4>
                      <p className="text-base leading-relaxed">
                        {result.explanation.split('\n\n')[0] || 'Contact occurred due to a late move.'}
                      </p>
                    </div>

                    {/* OVERTAKER TIP */}
                    <div className="bg-red-50 dark:bg-red-900/20 p-4 rounded-lg border-l-4 border-red-500">
                      <h4 className="font-bold text-red-700 dark:text-red-300 mb-2">Overtaker (Car A) – Better Move</h4>
                      <p className="text-base leading-relaxed">
                        <strong>Decision:</strong> {result.overtake_tip || result.explanation.match(/Tip A[:\s]+(.+?)(?:\n|$)/i)?.[1] || 'Wait for full overlap at apex.'}
                        <br />
                        <strong>Spotter Use:</strong> Listen for "car alongside" call — only commit when confirmed.
                      </p>
                    </div>

                    {/* DEFENDER TIP */}
                    <div className="bg-green-50 dark:bg-green-900/20 p-4 rounded-lg border-l-4 border-green-500">
                      <h4 className="font-bold text-green-700 dark:text-green-300 mb-2">Defender (Car B) – Better Defense</h4>
                      <p className="text-base leading-relaxed">
                        <strong>Action:</strong> {result.defend_tip || result.explanation.match(/Tip B[:\s]+(.+?)(?:\n|$)/i)?.[1] || 'Brake earlier or widen line to force clean pass.'}
                        <br />
                        <strong>Spotter Use:</strong> React to "car inside!" call immediately — de-escalate before contact.
                      </p>
                    </div>
                  </div>

                  {/* COPY BUTTONS */}
                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={() => {
                        const full = `[AI DRAFT]\n\n**Rule:** ${result.rule}\n**Fault:** A ${result.fault['Car A']} / B ${result.fault['Car B']}\n**Cars:** ${result.car_identification}\n**Confidence:** ${result.confidence}\n\n**Summary:** ${result.explanation.split('\n\n')[0]}\n\n**Overtaker Tip:** ${result.overtake_tip || 'Wait for overlap'}\n**Defender Tip:** ${result.defend_tip || 'React to spotter'}\n\n---\n*Draft by AI – Final verdict by steward.*`;
                        navigator.clipboard.writeText(full);
                        alert('Full verdict copied!');
                      }}
                      className="flex-1 p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold"
                    >
                      Copy Full Verdict
                    </button>
                    <button
                      onClick={() => {
                        const short = `A ${result.fault['Car A']} / B ${result.fault['Car B']} – ${result.rule.split('(')[0].trim()}`;
                        navigator.clipboard.writeText(short);
                        alert('Short summary copied!');
                      }}
                      className="flex-1 p-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-bold"
                    >
                      Copy Short Summary
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
