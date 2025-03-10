
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../integrations/supabase/client';
import { toast } from 'sonner';
import { Reservation, ReservationStatus } from '../types/reservation';
import { useReservationSubscription } from './useReservationSubscription';

/**
 * Main dashboard hook that combines reservation fetching, filtering, and realtime updates
 */
export const useDashboard = () => {
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [filteredReservations, setFilteredReservations] = useState<Reservation[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  
  /**
   * Fetch reservations from Supabase and apply filters
   */
  const fetchReservations = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      console.log('Fetching reservations from database...');
      
      const { data, error } = await supabase
        .from('reservations')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) {
        console.error('Supabase error:', error);
        throw new Error(`Failed to fetch reservations: ${error.message}`);
      }
      
      console.log('Raw reservation data from Supabase:', data);
      
      if (!data || !Array.isArray(data)) {
        console.error('Invalid data format:', data);
        throw new Error('Received invalid data format from server');
      }
      
      const processedReservations: Reservation[] = data.map(item => ({
        id: item.id,
        name: item.name,
        phone: item.phone,
        date: item.date,
        timeSlot: item.time_slot,
        status: item.status as ReservationStatus,
        createdAt: item.created_at
      }));
      
      setReservations(processedReservations);
      applyFilters(processedReservations, searchQuery);
      setIsLoading(false);
      setLastRefreshed(new Date());
      
      // Reset retry count on successful fetch
      if (retryCount > 0) {
        setRetryCount(0);
      }
    } catch (error) {
      console.error('Error fetching reservations:', error);
      setError(error instanceof Error ? error.message : 'Failed to load reservations');
      setIsLoading(false);
      toast.error('Failed to load reservations. Will retry automatically.');
      
      // Schedule a retry if error occurs
      if (retryCount < 3) {
        const timeout = setTimeout(() => {
          console.log(`Retrying fetch (attempt ${retryCount + 1})...`);
          setRetryCount(prev => prev + 1);
          fetchReservations();
        }, 3000 * (retryCount + 1));
        
        return () => clearTimeout(timeout);
      }
    }
  }, [searchQuery, retryCount]);
  
  // Apply filters based on search query
  const applyFilters = (reservationList: Reservation[], query: string) => {
    if (!query) {
      setFilteredReservations(reservationList);
      return;
    }
    
    const filtered = reservationList.filter(reservation => {
      return reservation.name.toLowerCase().includes(query.toLowerCase()) ||
             reservation.phone.includes(query);
    });
    
    setFilteredReservations(filtered);
  };
  
  // Delete reservation function
  const deleteReservation = useCallback(async (id: string): Promise<boolean> => {
    try {
      console.log(`Attempting to delete reservation with ID: ${id}`);
      
      const { error } = await supabase
        .from('reservations')
        .delete()
        .eq('id', id);
      
      if (error) {
        console.error('Error deleting reservation:', error);
        toast.error('Failed to delete reservation');
        return false;
      }
      
      console.log(`Successfully deleted reservation with ID: ${id}`);
      toast.success('Reservation deleted successfully');
      
      setReservations(prev => prev.filter(reservation => reservation.id !== id));
      setFilteredReservations(prev => prev.filter(reservation => reservation.id !== id));
      
      return true;
    } catch (error) {
      console.error('Error deleting reservation:', error);
      toast.error('Failed to delete reservation');
      return false;
    }
  }, []);
  
  // Manual refresh function
  const refreshData = useCallback(() => {
    fetchReservations();
  }, [fetchReservations]);
  
  // Set up realtime subscription
  useReservationSubscription({
    onInsert: (newReservation) => {
      setReservations(prev => {
        const updatedReservations = [newReservation, ...prev];
        applyFilters(updatedReservations, searchQuery);
        return updatedReservations;
      });
    },
    onUpdate: (updatedReservation) => {
      setReservations(prev => {
        const updatedReservations = prev.map(reservation => 
          reservation.id === updatedReservation.id ? updatedReservation : reservation
        );
        applyFilters(updatedReservations, searchQuery);
        return updatedReservations;
      });
    },
    onDelete: (id) => {
      setReservations(prev => {
        const updatedReservations = prev.filter(
          reservation => reservation.id !== id
        );
        applyFilters(updatedReservations, searchQuery);
        return updatedReservations;
      });
    }
  });
  
  // Fetch reservations on initial load
  useEffect(() => {
    const fetchInitialData = async () => {
      await fetchReservations();
    };
    
    fetchInitialData();
    
    // Set up periodic refresh every 2 minutes as a backup in case realtime fails
    const intervalId = setInterval(() => {
      console.log('Performing periodic data refresh...');
      fetchReservations();
    }, 120000);
    
    return () => clearInterval(intervalId);
  }, [fetchReservations]);
  
  /**
   * Update search query and filter reservations
   */
  const handleSetSearchQuery = (query: string) => {
    setSearchQuery(query);
    applyFilters(reservations, query);
  };
  
  return {
    reservations,
    filteredReservations,
    searchQuery,
    isLoading,
    error,
    lastRefreshed,
    setSearchQuery: handleSetSearchQuery,
    refreshData,
    deleteReservation
  };
};

export type { Reservation } from '../types/reservation';
