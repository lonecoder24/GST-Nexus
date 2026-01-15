import React from 'react';
import { LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: string;
  color: 'blue' | 'red' | 'green' | 'amber' | 'purple';
  onClick?: () => void;
}

const styles = {
  blue: {
    bg: 'bg-gradient-to-br from-blue-500 to-blue-600',
    shadow: 'shadow-blue-200',
    iconBg: 'bg-white/20'
  },
  red: {
    bg: 'bg-gradient-to-br from-rose-500 to-rose-600',
    shadow: 'shadow-rose-200',
    iconBg: 'bg-white/20'
  },
  green: {
    bg: 'bg-gradient-to-br from-emerald-500 to-emerald-600',
    shadow: 'shadow-emerald-200',
    iconBg: 'bg-white/20'
  },
  amber: {
    bg: 'bg-gradient-to-br from-amber-400 to-amber-500',
    shadow: 'shadow-amber-200',
    iconBg: 'bg-white/20'
  },
  purple: {
    bg: 'bg-gradient-to-br from-violet-500 to-violet-600',
    shadow: 'shadow-violet-200',
    iconBg: 'bg-white/20'
  }
};

const StatsCard: React.FC<StatsCardProps> = ({ title, value, icon: Icon, trend, color, onClick }) => {
  const theme = styles[color];
  
  return (
    <div 
        onClick={onClick}
        className={`relative overflow-hidden rounded-2xl p-6 ${theme.bg} text-white shadow-lg ${theme.shadow} transition-all duration-300 hover:scale-[1.02] hover:shadow-xl cursor-pointer group`}
    >
      <div className="relative z-10 flex justify-between items-start">
        <div>
          <p className="text-white/80 font-medium text-sm mb-1">{title}</p>
          <h3 className="text-3xl font-bold tracking-tight text-white">{value}</h3>
          {trend && (
            <div className="mt-3 inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-white/20 text-white backdrop-blur-sm border border-white/10">
              {trend}
            </div>
          )}
        </div>
        <div className={`p-3 rounded-xl ${theme.iconBg} backdrop-blur-md shadow-inner border border-white/10 group-hover:bg-white/30 transition-colors`}>
          <Icon size={24} className="text-white" />
        </div>
      </div>
      
      {/* Decorative background elements */}
      <div className="absolute -bottom-6 -right-6 w-32 h-32 bg-white/10 rounded-full blur-2xl pointer-events-none group-hover:bg-white/20 transition-colors"></div>
      <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-b from-white/10 to-transparent opacity-50 pointer-events-none"></div>
    </div>
  );
};

export default StatsCard;