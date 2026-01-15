
import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { NoticeStatus } from '../types';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Clock, Gavel } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const CalendarView: React.FC = () => {
  const navigate = useNavigate();
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const notices = useLiveQuery(() => db.notices.toArray());
  const hearings = useLiveQuery(() => db.hearings.toArray());

  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const days = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();
    return { days, firstDay };
  };

  const { days, firstDay } = getDaysInMonth(currentDate);
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
    setSelectedDate(null);
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
    setSelectedDate(null);
  };

  // Helper to format date as YYYY-MM-DD for comparison
  const formatDateKey = (year: number, month: number, day: number) => {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };

  // Group events by date
  const eventsByDate: Record<string, any[]> = {};
  
  // Notice Due Dates
  notices?.forEach(notice => {
      if (notice.dueDate && notice.status !== NoticeStatus.CLOSED) {
          if (!eventsByDate[notice.dueDate]) eventsByDate[notice.dueDate] = [];
          eventsByDate[notice.dueDate].push({ type: 'due', notice });
      }
  });

  // Hearings from new table
  hearings?.forEach(hearing => {
      if (hearing.date) {
          const relatedNotice = notices?.find(n => n.id === hearing.noticeId);
          if (relatedNotice) {
              if (!eventsByDate[hearing.date]) eventsByDate[hearing.date] = [];
              eventsByDate[hearing.date].push({ type: 'hearing', notice: relatedNotice, hearingDetail: hearing });
          }
      }
  });

  const renderCalendar = () => {
    const calendarDays = [];
    // Empty cells for days before the first of the month
    for (let i = 0; i < firstDay; i++) {
      calendarDays.push(<div key={`empty-${i}`} className="h-32 bg-slate-50 border-b border-r border-slate-200"></div>);
    }

    // Days of the month
    for (let d = 1; d <= days; d++) {
      const dateKey = formatDateKey(currentDate.getFullYear(), currentDate.getMonth(), d);
      const dayEvents = eventsByDate[dateKey] || [];
      const isToday = dateKey === new Date().toISOString().split('T')[0];
      const isSelected = selectedDate === dateKey;

      calendarDays.push(
        <div 
            key={d} 
            onClick={() => setSelectedDate(dateKey)}
            className={`h-32 border-b border-r border-slate-200 p-2 cursor-pointer transition-colors relative overflow-hidden group
                ${isToday ? 'bg-blue-50' : 'bg-white'} 
                ${isSelected ? 'ring-2 ring-inset ring-blue-500' : 'hover:bg-slate-50'}
            `}
        >
          <span className={`text-sm font-semibold rounded-full w-7 h-7 flex items-center justify-center ${isToday ? 'bg-blue-600 text-white' : 'text-slate-700'}`}>{d}</span>
          
          <div className="mt-2 space-y-1 overflow-y-auto max-h-[80px]">
              {dayEvents.slice(0, 3).map((event, idx) => (
                  <div key={`${event.notice.id}-${idx}`} className={`text-[10px] px-1.5 py-0.5 rounded truncate border ${event.type === 'hearing' ? 'bg-purple-100 text-purple-700 border-purple-200' : 'bg-red-50 text-red-600 border-red-100'}`}>
                      {event.type === 'hearing' ? '⚖️ Hearing' : '⚠️ Due'}
                  </div>
              ))}
              {dayEvents.length > 3 && (
                  <div className="text-[10px] text-slate-400 pl-1">+ {dayEvents.length - 3} more</div>
              )}
          </div>
        </div>
      );
    }
    return calendarDays;
  };

  const selectedEvents = selectedDate ? (eventsByDate[selectedDate] || []) : [];

  return (
    <div className="h-full flex flex-col md:flex-row gap-6 pb-6">
        <div className="flex-1 flex flex-col bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Calendar Header */}
            <div className="p-4 flex justify-between items-center bg-white border-b border-slate-200">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                    <CalendarIcon className="text-blue-600"/>
                    {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
                </h2>
                <div className="flex gap-2">
                    <button onClick={handlePrevMonth} className="p-2 hover:bg-slate-100 rounded-full text-slate-600"><ChevronLeft/></button>
                    <button onClick={() => setCurrentDate(new Date())} className="px-3 py-1 text-sm bg-slate-100 hover:bg-slate-200 rounded-lg text-slate-700 font-medium">Today</button>
                    <button onClick={handleNextMonth} className="p-2 hover:bg-slate-100 rounded-full text-slate-600"><ChevronRight/></button>
                </div>
            </div>

            {/* Weekday Headers */}
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                    <div key={day} className="py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">{day}</div>
                ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 flex-1 auto-rows-fr">
                {renderCalendar()}
            </div>
        </div>

        {/* Side Panel for Selected Date */}
        <div className="w-full md:w-80 flex-shrink-0">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 h-full flex flex-col">
                <div className="p-4 border-b border-slate-200 bg-slate-50">
                    <h3 className="font-bold text-slate-800">
                        {selectedDate ? new Date(selectedDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) : 'Select a date'}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                        {selectedEvents.length} Event{selectedEvents.length !== 1 ? 's' : ''}
                    </p>
                </div>
                <div className="p-4 flex-1 overflow-y-auto space-y-3">
                    {selectedDate && selectedEvents.length === 0 && (
                        <div className="text-center py-10 text-slate-400">
                            <Clock size={32} className="mx-auto mb-2 opacity-50"/>
                            <p>No events scheduled</p>
                        </div>
                    )}
                    {selectedEvents.map((evt, idx) => (
                        <div 
                            key={idx} 
                            onClick={() => navigate(`/notices/${evt.notice.id}`)}
                            className={`p-3 rounded-lg border cursor-pointer hover:shadow-md transition-all group ${
                                evt.type === 'hearing' ? 'bg-purple-50 border-purple-100 hover:border-purple-300' : 'bg-white border-slate-200 hover:border-blue-300'
                            }`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                                    evt.type === 'hearing' ? 'bg-purple-200 text-purple-800' : 'bg-red-100 text-red-700'
                                }`}>
                                    {evt.type === 'hearing' ? 'Hearing' : 'Due Date'}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">#{evt.notice.noticeNumber}</span>
                            </div>
                            <h4 className="font-semibold text-slate-800 text-sm group-hover:text-blue-600 transition-colors">
                                {evt.notice.gstin}
                            </h4>
                            <p className="text-xs text-slate-500 mt-1 line-clamp-1">{evt.notice.noticeType}</p>
                            
                            {evt.type === 'hearing' && evt.hearingDetail && (
                                <div className="mt-2 pt-2 border-t border-purple-200/50 flex flex-col gap-1 text-xs text-purple-700">
                                    <div className="flex items-center gap-2">
                                        <Gavel size={12}/>
                                        <span>{evt.hearingDetail.time}</span>
                                    </div>
                                    <span className="truncate opacity-75">{evt.hearingDetail.venue}</span>
                                    <span className={`text-[9px] px-1 rounded w-fit border ${
                                        evt.hearingDetail.status === 'Concluded' ? 'bg-green-100 border-green-200 text-green-700' : 'bg-purple-100 border-purple-200 text-purple-700'
                                    }`}>{evt.hearingDetail.status}</span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    </div>
  );
};

export default CalendarView;