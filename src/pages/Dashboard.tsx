
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import ReservationTable from '../components/ReservationTable';
import NotificationSettings from '../components/NotificationSettings';
import { 
  fetchReservations, 
  updateReservation, 
  Reservation, 
  logoutAdmin, 
  getSession,
  transformReservationRecord 
} from '../utils/api';
import { supabase } from '../integrations/supabase/client';
import { 
  sendReservationNotification
} from '../utils/pushNotificationService';
import { isAuthenticated, setAuthState, clearAuthState } from '../utils/authUtils';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const realtimeChannelRef = useRef<any>(null);
  const authCheckedRef = useRef(false);
  const [hasMounted, setHasMounted] = useState(false);
  const dataFetchAttemptedRef = useRef(false);

  // Explicitly log when component mounts and unmounts to track lifecycle
  useEffect(() => {
    console.log("===== Dashboard component MOUNTED =====");
    setHasMounted(true);
    
    return () => {
      console.log("===== Dashboard component UNMOUNTED =====");
    };
  }, []);

  useEffect(() => {
    if (!hasMounted) return; // Don't run until mounting is complete
    
    console.log("Dashboard authentication check starting...");
    
    const checkAuth = async () => {
      try {
        console.log("AUTH CHECK: Starting authentication verification");
        
        // Quick check first using local storage to prevent flicker
        if (!isAuthenticated()) {
          console.log('AUTH CHECK: Not authenticated based on local storage check');
          toast.error('Session expired. Please login again.');
          clearAuthState();
          navigate('/admin');
          return;
        }
        
        console.log("AUTH CHECK: Local auth check passed, verifying with Supabase...");
        
        // Then verify with Supabase
        const { data, error } = await getSession();
        
        if (error) {
          console.error('AUTH CHECK: Session error:', error);
          toast.error('Authentication error. Please login again.');
          clearAuthState();
          navigate('/admin');
          return;
        }
        
        if (!data.session) {
          console.log('AUTH CHECK: No active session found in Supabase check');
          toast.error('Session expired. Please login again.');
          clearAuthState();
          navigate('/admin');
          return;
        }
        
        console.log("AUTH CHECK: Supabase authentication verified successfully");
        
        // Renew authentication status
        setAuthState();
        
        if (!authCheckedRef.current) {
          authCheckedRef.current = true;
          console.log("AUTH CHECK: First successful auth check, proceeding to fetch data");
          
          dataFetchAttemptedRef.current = true;
          try {
            await fetchData();
            setupRealtimeSubscription();
          } catch (fetchError) {
            console.error("AUTH CHECK: Error in initial data fetch:", fetchError);
            setError("Failed to load reservations. Please try refreshing the page.");
            setLoading(false);
          }
        }
      } catch (err) {
        console.error('AUTH CHECK: Uncaught auth check error:', err);
        toast.error('Authentication error. Please login again.');
        clearAuthState();
        navigate('/admin');
      }
    };

    checkAuth();
    
    const intervalId = setInterval(checkAuth, 5 * 60 * 1000); // Check auth every 5 minutes
    
    return () => {
      console.log("Dashboard auth check cleanup, removing interval and realtime subscription");
      clearInterval(intervalId);
      removeRealtimeSubscription();
    };
  }, [navigate, hasMounted]);

  // Special catch-all in case the main authentication effect didn't initiate data fetching
  useEffect(() => {
    if (hasMounted && authCheckedRef.current && !dataFetchAttemptedRef.current && loading) {
      console.log("SAFETY CHECK: Data fetch not attempted yet despite auth being checked. Forcing fetch...");
      dataFetchAttemptedRef.current = true;
      fetchData();
    }
  }, [hasMounted, loading]);

  // Add a loading timeout to ensure we don't stay in loading state forever
  useEffect(() => {
    if (!hasMounted || !loading) return;
    
    const loadingTimeoutId = setTimeout(() => {
      if (loading) {
        console.log("TIMEOUT: Loading state has been active for too long, forcing reset");
        setLoading(false);
        setError("Loading timed out. Please try refreshing the page.");
      }
    }, 10000); // 10 second timeout for loading state
    
    return () => clearTimeout(loadingTimeoutId);
  }, [loading, hasMounted]);

  // Ensure reservations state is initialized properly
  useEffect(() => {
    if (reservations.length === 0 && !loading && !error && authCheckedRef.current && dataFetchAttemptedRef.current) {
      console.log("POST-LOAD CHECK: No reservations found but authentication passed, retrying fetch...");
      fetchData();
    }
  }, [reservations, loading, error]);
  
  const setupRealtimeSubscription = () => {
    console.log('Setting up real-time subscription to reservations...');
    
    try {
      removeRealtimeSubscription();
      
      const channel = supabase
        .channel('schema-db-changes')
        .on('postgres_changes', 
          {
            event: 'INSERT',
            schema: 'public',
            table: 'reservations'
          }, 
          (payload) => {
            console.log('New reservation received via real-time:', payload);
            
            if (payload.new && typeof payload.new === 'object') {
              handleNewReservation(payload.new);
            } else {
              console.error('Invalid payload received:', payload);
            }
          }
        )
        .on('postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'reservations'
          },
          (payload) => {
            console.log('Reservation update received via real-time:', payload);
            
            if (payload.new && typeof payload.new === 'object') {
              handleReservationUpdate(payload.new);
            } else {
              console.error('Invalid update payload received:', payload);
            }
          }
        )
        .subscribe((status) => {
          console.log('Real-time subscription status:', status);
          
          if (status === 'SUBSCRIBED') {
            console.log('Successfully subscribed to real-time updates for reservations');
            toast.success('Real-time updates activated');
          } else if (status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT) {
            console.error('Subscription timed out');
            toast.error('Real-time updates timed out');
          } else if (status === REALTIME_SUBSCRIBE_STATES.CLOSED) {
            console.error('Subscription closed');
            toast.error('Real-time connection closed');
          } else if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
            console.error('Channel error occurred');
            toast.error('Connection error with real-time service');
            
            setTimeout(() => {
              setupRealtimeSubscription();
            }, 5000);
          }
        });
      
      realtimeChannelRef.current = channel;
      console.log('Real-time subscription setup complete', channel);
    } catch (err) {
      console.error('Error setting up real-time subscription:', err);
      toast.error('Failed to set up real-time updates');
    }
  };

  const removeRealtimeSubscription = () => {
    const channel = realtimeChannelRef.current;
    if (channel) {
      console.log('Removing real-time subscription...');
      supabase.removeChannel(channel)
        .then(() => {
          console.log('Real-time subscription removed successfully');
          realtimeChannelRef.current = null;
        })
        .catch(err => {
          console.error('Error removing real-time subscription:', err);
        });
    }
  };

  const handleNewReservation = async (newRecord: any) => {
    try {
      console.log('Processing new reservation from real-time update:', newRecord);
      
      const newReservation = transformReservationRecord(newRecord);
      
      if (!newReservation) {
        console.error('Failed to transform reservation data');
        return;
      }
      
      setReservations(prevReservations => {
        const exists = prevReservations.some(res => res.id === newReservation.id);
        if (exists) {
          console.log('Reservation already exists in state, not adding duplicate');
          return prevReservations;
        }
        
        console.log('Adding new reservation to state');
        return [newReservation, ...prevReservations];
      });
      
      try {
        console.log('Attempting to send push notification for new reservation');
        // Ensure admin status is set before sending notification
        localStorage.setItem('isAuthenticated', 'true');
        sessionStorage.setItem('isAuthenticated', 'true');
        
        const notificationSent = sendReservationNotification({
          name: newReservation.name,
          phone: newReservation.phone,
          date: newReservation.date,
          timeSlot: newReservation.timeSlot
        });
        console.log('Push notification sent successfully:', notificationSent);
      } catch (notifError) {
        console.error('Failed to send push notification:', notifError);
      }
      
      toast.success('New reservation received', {
        description: `${newReservation.name} has booked for ${newReservation.date}`
      });
    } catch (err) {
      console.error('Error handling new reservation:', err);
    }
  };

  const handleReservationUpdate = (updatedRecord: any) => {
    try {
      console.log('Processing reservation update from real-time:', updatedRecord);
      
      const updatedReservation = transformReservationRecord(updatedRecord);
      
      if (!updatedReservation) {
        console.error('Failed to transform updated reservation data');
        return;
      }
      
      setReservations(prevReservations => 
        prevReservations.map(res => 
          res.id === updatedReservation.id ? updatedReservation : res
        )
      );
      
      toast.info('Reservation updated', {
        description: `${updatedReservation.name}'s reservation has been updated`
      });
    } catch (err) {
      console.error('Error handling reservation update:', err);
    }
  };

  const fetchData = async () => {
    console.log("FETCH: Starting reservation data fetch...");
    setLoading(true);
    setError(null);

    try {
      const result = await fetchReservations();
      console.log("FETCH: Reservation data received:", result);
      
      if (result.success) {
        setReservations(result.data || []);
        console.log("FETCH: Successfully set reservations data:", result.data?.length || 0, "items");
      } else {
        console.error("FETCH: API reported error:", result.message);
        
        if (result.message === 'Not authenticated') {
          clearAuthState();
          toast.error('Your session has expired. Please login again.');
          navigate('/admin');
          return;
        }
        
        setError(result.message || 'Failed to fetch reservations');
        toast.error(result.message || 'Failed to fetch reservations');
      }
    } catch (err) {
      console.error('FETCH: Error fetching data:', err);
      setError('Network error. Please try again.');
      toast.error('Network error. Please try again.');
    } finally {
      console.log("FETCH: Completed fetch process, setting loading to false");
      setLoading(false);
    }
  };

  const handleStatusChange = async (id: string, status: Reservation['status']) => {
    try {
      const result = await updateReservation(id, { status });
      if (result.success) {
        setReservations(prev =>
          prev.map(res => (res.id === id ? { ...res, status } : res))
        );
        toast.success('Reservation status updated successfully');
      } else {
        toast.error(result.message || 'Failed to update reservation status');
      }
    } catch (err) {
      console.error('Error updating status:', err);
      toast.error('Network error. Please try again.');
    }
  };

  const handleUpdate = async (id: string, updatedData: Partial<Reservation>) => {
    try {
      const result = await updateReservation(id, updatedData);
      if (result.success) {
        setReservations(prev =>
          prev.map(res => (res.id === id ? { ...res, ...updatedData } : res))
        );
        toast.success('Reservation updated successfully');
      } else {
        toast.error(result.message || 'Failed to update reservation');
      }
    } catch (err) {
      console.error('Error updating reservation:', err);
      toast.error('Network error. Please try again.');
    }
  };

  const handleLogout = async () => {
    try {
      console.log("LOGOUT: Initiating logout process...");
      removeRealtimeSubscription();
      
      const result = await logoutAdmin();
      clearAuthState();
      
      if (result.success) {
        toast.success('Logged out successfully');
      } else {
        toast.error(result.message || 'Logout failed, but local session cleared');
      }
      
      navigate('/admin');
    } catch (err) {
      console.error('LOGOUT: Error during logout:', err);
      clearAuthState();
      toast.error('Error during logout, but local session cleared');
      navigate('/admin');
    }
  };

  console.log("RENDER STATE: loading=", loading, "error=", error, "reservations.length=", reservations.length);

  if (loading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-[80vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <span className="text-lg">Loading reservations...</span>
        <p className="text-sm text-gray-500 mt-2">Please wait while we load your dashboard</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto p-4">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-semibold text-gray-800">Reservations Dashboard</h1>
          <button
            onClick={handleLogout}
            className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Logout
          </button>
        </div>
        
        <div className="flex flex-col justify-center items-center p-8 bg-white rounded-lg shadow">
          <div className="text-red-500 mb-4">Error: {error}</div>
          <button 
            onClick={fetchData}
            className="bg-primary hover:bg-primary/90 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-4 overflow-x-hidden">
      <div className="flex flex-col sm:flex-row justify-between items-center mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold text-gray-800 mb-4 sm:mb-0">Reservations Dashboard</h1>
        <button
          onClick={handleLogout}
          className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline w-full sm:w-auto"
        >
          Logout
        </button>
      </div>
      
      <NotificationSettings />
      
      {reservations.length === 0 ? (
        <div className="mt-8 text-center p-6 bg-white rounded-lg shadow">
          <p className="text-lg text-gray-600">No reservations found.</p>
          <button 
            onClick={fetchData}
            className="mt-4 bg-primary hover:bg-primary/90 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
          >
            Refresh
          </button>
        </div>
      ) : (
        <ReservationTable
          reservations={reservations}
          onStatusChange={handleStatusChange}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
};

export default Dashboard;
