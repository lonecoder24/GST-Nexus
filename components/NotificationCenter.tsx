import React, { useState } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

const NotificationCenter: React.FC = () => {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();

  // Fetch notifications for current user OR system-wide (userId is undefined/null)
  const notifications = useLiveQuery(async () => {
    if (!user) return [];
    
    return await db.notifications
      .filter(n => (n.userId === user.id || n.userId === undefined) && !n.isRead)
      .reverse()
      .sortBy('createdAt');
  }, [user]);

  const markAsRead = async (id: number) => {
    await db.notifications.update(id, { isRead: true });
  };

  const handleNotificationClick = async (notification: any) => {
    await markAsRead(notification.id!);
    if (notification.link) {
      navigate(notification.link);
      setIsOpen(false);
    }
  };

  const unreadCount = notifications?.length || 0;

  return (
    <div className="relative z-50">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-slate-500 hover:bg-slate-100 rounded-full transition-colors"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 border-2 border-white rounded-full"></span>
        )}
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)}></div>
          <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-200 z-50 overflow-hidden">
            <div className="p-3 border-b bg-slate-50 flex justify-between items-center">
              <h3 className="font-semibold text-sm text-slate-800">Notifications</h3>
              {unreadCount > 0 && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {notifications && notifications.length > 0 ? (
                notifications.map((notif) => (
                  <div 
                    key={notif.id} 
                    className={`p-3 border-b hover:bg-slate-50 cursor-pointer transition-colors ${
                      notif.type === 'critical' ? 'bg-red-50 hover:bg-red-100' : ''
                    }`}
                    onClick={() => handleNotificationClick(notif)}
                  >
                    <div className="flex justify-between items-start gap-2">
                        <div className="flex-1">
                            <h4 className={`text-sm font-medium ${
                                notif.type === 'critical' ? 'text-red-700' : 
                                notif.type === 'warning' ? 'text-amber-700' : 'text-slate-800'
                            }`}>
                                {notif.title}
                            </h4>
                            <p className="text-xs text-slate-600 mt-1">{notif.message}</p>
                            <span className="text-[10px] text-slate-400 mt-2 block">
                                {new Date(notif.createdAt).toLocaleString()}
                            </span>
                        </div>
                        <button 
                            onClick={(e) => { e.stopPropagation(); markAsRead(notif.id!); }}
                            className="text-slate-400 hover:text-blue-500 p-1"
                        >
                            <Check size={14} />
                        </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-slate-400 text-sm">
                  No new notifications
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default NotificationCenter;