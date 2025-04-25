'use client';

import { useEffect, useState, useRef } from 'react';

const useTypewriterPlaceholder = (phrases, delay = 100) => {
  const [placeholder, setPlaceholder] = useState('');
  const [index, setIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    const currentPhrase = phrases[index];
    const timeout = setTimeout(() => {
      if (charIndex < currentPhrase.length) {
        setPlaceholder((prev) => prev + currentPhrase[charIndex]);
        setCharIndex((prev) => prev + 1);
      } else {
        setTimeout(() => {
          setPlaceholder('');
          setCharIndex(0);
          setIndex((prev) => (prev + 1) % phrases.length);
        }, 2000);
      }
    }, delay);

    return () => clearTimeout(timeout);
  }, [charIndex, index, delay, phrases]);

  return placeholder;
};

export default function Home() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(9);
  const [usedFallback, setUsedFallback] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef(null);

  const dynamicPlaceholder = useTypewriterPlaceholder([
    '🔍 AI Search: Find React skills in Bangalore...',
    '🔍 AI Search: Software engineers in Delhi...',
    '🔍 AI Search: softwear Engineers working  in Pune...',
  ]);

  const fetchResults = async (currentPage = page) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, page: currentPage, pageSize }),
      });

      const data = await response.json();
      if (response.ok) {
        setResults(data.results);
        setTotalCount(data.totalCount);
        setUsedFallback(data.usedFallback);
        setPage(data.page);
        containerRef.current?.scrollIntoView({ behavior: 'smooth' });
      } else {
        setError(data.message || 'Failed to fetch results');
      }
    } catch (err) {
      setError('An error occurred while fetching results');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    fetchResults(1);
  };

  const handleNextPage = () => {
    const next = page + 1;
    if (next <= Math.ceil(totalCount / pageSize)) {
      fetchResults(next);
    }
  };

  const handlePrevPage = () => {
    const prev = page - 1;
    if (prev >= 1) {
      fetchResults(prev);
    }
  };

  return (
    <div
      ref={containerRef}
      className="min-h-screen bg-gradient-to-br from-gray-100 via-white to-pink-50 p-2  sm:p-4 lg:p-6 flex flex-col items-center text-gray-900"
      style={{
        fontFamily: "'Inter', sans-serif",
        backgroundImage: 'radial-gradient(circle at 50% 50%, rgba(255, 182, 193, 0.2) 0%, transparent 50%)',
      }}
    >
     {/* Futuristic Heading */}
     <h1 className="m-3 right-1 sm:right-2 top-1/2 transform -translate-y-1/2 bg-gradient-to-r from-cyan-500 to-purple-500 text-white px-2 sm:px-3 py-1 sm:py-1.5 lg:py-2 rounded-full hover:from-cyan-600 hover:to-purple-600 disabled:opacity-50 text-xs sm:text-sm lg:text-base shadow-md transition-all">
        AI Employee Search
      </h1>

      {/* Search Form with Glassmorphism */}
      <form onSubmit={handleSearch} className="w-full max-w-xs sm:max-w-md lg:max-w-2xl">
        <div className="relative w-full mb-4 sm:mb-6">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={dynamicPlaceholder || 'Search...'}
            className="w-full py-2 sm:py-3 pl-4 sm:pl-5 pr-12 sm:pr-14 text-sm sm:text-base lg:text-lg rounded-full border-2 border-opacity-20 border-cyan-400 bg-gray-800 bg-opacity-50 text-cyan-200 placeholder-cyan-300 shadow-lg focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all backdrop-blur-md"
            style={{ boxShadow: '0 4px 20px rgba(0, 255, 255, 0.2)' }}
          />
          <button
            type="submit"
            disabled={loading}
            className="absolute right-1 sm:right-2 top-1/2 transform -translate-y-1/2 bg-gradient-to-r from-cyan-500 to-purple-500 text-white px-2 sm:px-3 py-1 sm:py-1.5 lg:py-2 rounded-full hover:from-cyan-600 hover:to-purple-600 disabled:opacity-50 text-xs sm:text-sm lg:text-base shadow-md transition-all"
          >
            {loading ? (
              <div className="flex items-center">
                <div className="w-4 h-4 sm:w-5 sm:h-5 border-2 border-t-transparent border-cyan-300 rounded-full animate-spin mr-1"></div>
                <span>Scanning...</span>
              </div>
            ) : (
              'Search'
            )}
          </button>
        </div>
      </form>

      {/* Error Message with Clear Styling */}
      {error && (
        <div className="w-full max-w-xs sm:max-w-md lg:max-w-2xl bg-red-100 text-red-700 p-3 sm:p-4 rounded-lg mb-4 sm:mb-6 text-center text-sm sm:text-base border border-red-300 shadow-sm">
          {error}
        </div>
      )}

      {/* Results Section */}
      {results.length > 0 && (
        <div className="w-full max-w-xs sm:max-w-md lg:max-w-6xl space-y-4 sm:space-y-6">
          <div className="text-sm sm:text-base lg:text-lg text-gray-700 text-center mb-2 sm:mb-4">
            <strong>{usedFallback ? '🛟 Text search fallback used' : '✅ AI search matched'}</strong>
            <br />
            Page <strong>{page}</strong> of <strong>{Math.ceil(totalCount / pageSize)}</strong> (Total:{' '}
            <strong>{totalCount}</strong>)
          </div>

          {/* Card Grid with Minimalist Design */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {results.map((employee) => (
              <div
                key={employee._id}
                className="relative bg-white p-4 sm:p-5 rounded-lg shadow-md border border-gray-200 hover:shadow-lg hover:border-coral-300 transition-all duration-300"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-coral-100 to-pink-100 rounded-lg opacity-0 hover:opacity-20 transition-opacity duration-300"></div>
                <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2 relative z-10">
                  {employee.name}
                </h2>
                <p className="text-sm sm:text-base text-gray-700 relative z-10">
                  <strong>Role:</strong> {employee.role}
                </p>
                <p className="text-sm sm:text-base text-gray-700 relative z-10">
                  <strong>Location:</strong> {employee.location}
                </p>
                <p className="text-sm sm:text-base text-gray-700 relative z-10">
                  <strong>Experience:</strong> {employee.experience} years
                </p>
                <p className="text-sm sm:text-base text-gray-700 relative z-10">
                  <strong>Skills:</strong>{' '}
                  <span className="whitespace-normal break-words">{employee.skills.join(', ')}</span>
                </p>
              </div>
            ))}
          </div>

          {/* Pagination with Modern Buttons */}
          <div className="flex justify-between items-center py-2 sm:py-4">
            <button
              onClick={handlePrevPage}
              disabled={page === 1}
              className="bg-white text-gray-700 font-medium px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg border border-gray-300 hover:bg-coral-100 hover:text-coral-700 disabled:opacity-50 disabled:hover:bg-white text-sm sm:text-base transition-all"
            >
              Previous
            </button>
            <span className="font-semibold text-gray-900 text-sm sm:text-base lg:text-lg">
              Page {page}
            </span>
            <button
              onClick={handleNextPage}
              disabled={page >= Math.ceil(totalCount / pageSize)}
              className="bg-white text-gray-700 font-medium px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg border border-gray-300 hover:bg-coral-100 hover:text-coral-700 disabled:opacity-50 disabled:hover:bg-white text-sm sm:text-base transition-all"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}