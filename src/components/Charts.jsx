import React from "react";

export const SimpleBarChart = ({
  data,
  labels,
  title,
  color = "bg-blue-500",
}) => {
  const maxVal = Math.max(...data, 1);
  return (
    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 h-full flex flex-col">
      <h4 className="text-xs font-bold text-slate-400 mb-6 uppercase tracking-widest">
        {title}
      </h4>
      <div className="flex items-end gap-1.5 h-32 mt-auto">
        {data.map((val, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col items-center group relative h-full justify-end"
          >
            <span className="text-[10px] font-black text-slate-300 mb-1">
              {val}
            </span>
            <div
              className={`w-full ${color} rounded-t transition-all duration-700 ease-out`}
              style={{
                height: `${(val / maxVal) * 80}%`,
                minHeight: val > 0 ? "4px" : "0px",
              }}
            />
            <span className="text-[10px] text-slate-500 mt-2 font-mono font-bold">
              {labels[i]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const SimplePieChart = ({ data, labels, title }) => {
  const total = data.reduce((a, b) => a + b, 0);
  const colorHex = ["#3b82f6", "#a855f7", "#10b981", "#f59e0b"];
  const colorsBg = [
    "bg-blue-500",
    "bg-purple-500",
    "bg-emerald-500",
    "bg-amber-500",
  ];
  let cumulative = 0;
  const gradientParts = data.map((val, i) => {
    const start = (cumulative / total) * 100;
    cumulative += val;
    const end = (cumulative / total) * 100;
    return `${colorHex[i % colorHex.length]} ${start}% ${end}%`;
  });
  const gradient =
    total > 0 ? `conic-gradient(${gradientParts.join(", ")})` : `transparent`;
  return (
    <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 h-full">
      <h4 className="text-xs font-bold text-slate-400 mb-6 uppercase tracking-widest">
        {title}
      </h4>
      <div className="flex items-center gap-6">
        <div
          className="relative w-24 h-24 rounded-full border-4 border-slate-700 flex items-center justify-center bg-slate-900/50 shadow-inner flex-shrink-0"
          style={{ background: gradient }}
        >
          <div className="absolute inset-2 bg-slate-900 rounded-full flex items-center justify-center border border-slate-700/50 shadow-lg">
            <span className="text-xl font-black text-white">{total}</span>
          </div>
        </div>
        <div className="flex-1 space-y-2">
          {data.map((val, i) => (
            <div key={i} className="flex flex-col text-[11px]">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div
                    className={`w-2 h-2 rounded-full ${colorsBg[i % colorsBg.length]}`}
                  ></div>
                  <span className="text-slate-300 font-medium">
                    {labels[i]}
                  </span>
                </div>
                <span className="font-bold text-slate-400">{val}</span>
              </div>
              <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className={`h-full ${colorsBg[i % colorsBg.length]}`}
                  style={{
                    width: total > 0 ? `${(val / total) * 100}%` : "0%",
                  }}
                ></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
