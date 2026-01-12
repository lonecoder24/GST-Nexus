import React, { createContext, useContext, useState, useEffect } from 'react';
import { db } from '../db';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  login: (username: string, passwordHash: string) => Promise<boolean>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Check local storage for session (simple persistence)
    const storedUser = localStorage.getItem('gst_nexus_user');
    if (storedUser) {
      setUser(JSON.parse(storedUser));
    }
    setIsLoading(false);
  }, []);

  const login = async (username: string, passwordHash: string) => {
    // In a real app, hash the input password before comparing
    const foundUser = await db.users.where('username').equals(username).first();
    
    if (foundUser && foundUser.passwordHash === passwordHash && foundUser.isActive) {
      setUser(foundUser);
      localStorage.setItem('gst_nexus_user', JSON.stringify(foundUser));
      
      // Log login
      await db.auditLogs.add({
          entityType: 'Auth',
          entityId: foundUser.id || 0,
          action: 'Login',
          timestamp: new Date().toISOString(),
          user: foundUser.username,
          details: 'User logged in'
      });
      return true;
    }
    return false;
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('gst_nexus_user');
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};