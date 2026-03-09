import React from 'react';
import qaData from '../data/master_qa.json'; 

// This helper removes dashes and spaces to make matching bulletproof
const normalize = (id) => id ? id.replace(/[-\s]/g, '').toUpperCase() : "";

const CardQA = ({ currentCardId }) => {
  // 1. Filter the master list for this specific card
  const matches = qaData.filter(item => 
    normalize(item.cardId) === normalize(currentCardId)
  );

  // 2. If no Q&A found, don't show the component at all
  if (matches.length === 0) return null;

  return (
    <div className="mt-6 border-t border-slate-700 pt-2">
      <h3 className="text-sm font-bold text-blue-400 mb-4 flex items-center gap-2">
        常見問答 (Q&A)
      </h3>
      
      <div className="space-y-4">
        {matches.map((item, index) => (
          <div key={index} className="bg-slate-800/40 rounded-lg p-1 border border-slate-700">
            <div className="flex items-start gap-3">
              <span className="bg-blue-600/20 text-blue-400 text-[10px] px-2 py-0.5 rounded border border-blue-600/30 font-bold mt-1">
                {item.qaNum}
              </span>
              <div className="flex-1">
                <p className="text-slate-100 text-sm font-medium mb-1 leading-relaxed">
                  <span className="text-red-500 font-bold mr-2">Q:</span>
                  {item.question}
                </p>
                <div className="text-slate-400 text-sm leading-relaxed border-slate-700">
                  <span className="text-green-500 font-bold mr-2">A:</span>
                  {item.answer}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CardQA;