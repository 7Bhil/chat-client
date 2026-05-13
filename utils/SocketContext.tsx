import React, { createContext, useContext, useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getUser } from './api';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({ socket: null, isConnected: false });

export const useSocket = () => useContext(SocketContext);

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    let s: Socket;
    
    const initSocket = async () => {
      const user = await getUser();
      if (!user) return;

      s = io('http://10.81.95.51:5000'); // Updated to your machine IP

      s.on('connect', () => {
        setIsConnected(true);
        s.emit('register_socket', user.id);
      });

      s.on('disconnect', () => {
        setIsConnected(false);
      });

      setSocket(s);
    };

    initSocket();

    return () => {
      if (s) s.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};
