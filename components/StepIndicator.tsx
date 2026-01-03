import React from 'react';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { StepProps } from '../types';

interface Props {
  steps: StepProps[];
}

export const StepIndicator: React.FC<Props> = ({ steps }) => {
  return (
    <div className="flex w-full justify-between items-center mb-8 px-4 max-w-2xl mx-auto">
      {steps.map((step, idx) => (
        <div key={idx} className="flex flex-col items-center relative z-10 group">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 border-2 ${
              step.isCompleted
                ? 'bg-emerald-500 border-emerald-500 text-white'
                : step.isActive
                ? 'bg-indigo-600 border-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.5)]'
                : 'bg-zinc-800 border-zinc-700 text-zinc-500'
            }`}
          >
            {step.isCompleted ? (
              <CheckCircle2 size={20} />
            ) : step.isActive ? (
              <Loader2 size={20} className="animate-spin" />
            ) : (
              <Circle size={20} />
            )}
          </div>
          <span
            className={`absolute -bottom-6 text-xs font-medium whitespace-nowrap transition-colors ${
              step.isActive || step.isCompleted ? 'text-indigo-300' : 'text-zinc-600'
            }`}
          >
            {step.title}
          </span>
          {/* Connector Line */}
          {idx < steps.length - 1 && (
            <div
              className={`absolute top-5 left-full w-[calc(100vw/5)] max-w-[80px] h-[2px] -translate-y-1/2 -z-10 transition-colors duration-500 ${
                step.isCompleted ? 'bg-emerald-500' : 'bg-zinc-800'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
};