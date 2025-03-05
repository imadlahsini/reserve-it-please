
/**
 * API configuration and utility functions using Supabase
 */
import { createClient } from '@supabase/supabase-js';

// Supabase configuration - using our standard client
import { supabase } from '../integrations/supabase/client';

// Re-export supabase for backward compatibility
export { supabase };

// Types
export interface Reservation {
  id: string;
  name: string;
  phone: string;
  date: string;
  timeSlot: string;
  status: 'Pending' | 'Confirmed' | 'Canceled' | 'Not Responding';
}

export interface LoginCredentials {
  email: string;
  password: string;
}

// API functions
export async function createReservation(reservationData: Omit<Reservation, 'id' | 'status'>): Promise<{ success: boolean; message: string; id?: string }> {
  console.log('Starting reservation creation process with Supabase...');
  console.log('Reservation data:', JSON.stringify(reservationData));
  
  try {
    // Convert the timeSlot property to time_slot for Supabase
    const { data, error } = await supabase
      .from('reservations')
      .insert({
        name: reservationData.name,
        phone: reservationData.phone,
        date: reservationData.date,
        time_slot: reservationData.timeSlot,
        status: 'Pending'
      })
      .select();
    
    if (error) {
      console.error('Supabase error:', error);
      return { 
        success: false, 
        message: error.message || 'Error creating reservation' 
      };
    }
    
    console.log('Reservation created successfully:', data);
    return { 
      success: true, 
      message: 'Reservation created successfully',
      id: data?.[0]?.id
    };
  } catch (error) {
    console.error('Error creating reservation:', error);
    
    let errorMessage = 'Network error. Please try again.';
    if (error instanceof Error) {
      errorMessage = `Error: ${error.message}`;
    }
    
    return { success: false, message: errorMessage };
  }
}

export async function fetchReservations(): Promise<{ success: boolean; data?: Reservation[]; message?: string }> {
  try {
    console.log('Fetching reservations from Supabase...');
    
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !sessionData.session) {
      return { success: false, message: 'Not authenticated' };
    }
    
    const { data, error } = await supabase
      .from('reservations')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) {
      console.error('Supabase error:', error);
      return { 
        success: false, 
        message: error.message || 'Error fetching reservations' 
      };
    }
    
    console.log('Raw data from Supabase:', data);
    
    // Transform data to match the expected format
    const transformedData = data.map(reservation => ({
      id: reservation.id,
      name: reservation.name,
      phone: reservation.phone,
      date: reservation.date,
      timeSlot: reservation.time_slot,
      status: reservation.status as Reservation['status']
    }));
    
    console.log('Transformed reservation data:', transformedData);
    return { 
      success: true, 
      data: transformedData 
    };
  } catch (error) {
    console.error('Error fetching reservations:', error);
    return { success: false, message: 'Network error. Please try again.' };
  }
}

export async function updateReservation(
  id: string,
  updates: Partial<Reservation>
): Promise<{ success: boolean; message: string }> {
  try {
    console.log(`Updating reservation ${id} with:`, updates);
    
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError || !sessionData.session) {
      return { success: false, message: 'Not authenticated' };
    }
    
    // Transform updates to match Supabase column names
    const supabaseUpdates: any = { ...updates };
    if (updates.timeSlot) {
      supabaseUpdates.time_slot = updates.timeSlot;
      delete supabaseUpdates.timeSlot;
    }
    
    // IMPORTANT: Set manual_update flag for status changes
    // This signals to the webhook that this change was made manually from the UI
    if (updates.status) {
      supabaseUpdates.manual_update = true;
      console.log(`Setting manual_update flag for reservation ${id} with status ${updates.status}`);
    }
    
    const { error } = await supabase
      .from('reservations')
      .update(supabaseUpdates)
      .eq('id', id);
    
    if (error) {
      console.error('Supabase error:', error);
      return { 
        success: false, 
        message: error.message || 'Error updating reservation' 
      };
    }
    
    console.log(`Reservation ${id} updated successfully in the database`);
    
    // Verify the update was successful by fetching the updated record
    const { data: verificationData, error: verificationError } = await supabase
      .from('reservations')
      .select('*')
      .eq('id', id)
      .single();
      
    if (verificationError) {
      console.warn('Error verifying update:', verificationError);
    } else {
      console.log(`Verification data:`, verificationData);
      
      // Check if status was updated correctly (if it was part of the updates)
      if (updates.status && verificationData.status !== updates.status) {
        console.warn(`Status verification failed: Expected ${updates.status}, got ${verificationData.status}`);
        
        // Retry the update if verification failed
        console.log(`Retrying update for reservation ${id} with status ${updates.status}`);
        const { error: retryError } = await supabase
          .from('reservations')
          .update({
            ...supabaseUpdates,
            manual_update: true
          })
          .eq('id', id);
          
        if (retryError) {
          console.error('Retry update error:', retryError);
        } else {
          console.log(`Retry update for reservation ${id} succeeded`);
        }
      }
    }
    
    return { 
      success: true, 
      message: 'Reservation updated successfully' 
    };
  } catch (error) {
    console.error('Error updating reservation:', error);
    return { success: false, message: 'Network error. Please try again.' };
  }
}

export async function loginAdmin(credentials: LoginCredentials): Promise<{ success: boolean; message?: string }> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: credentials.email,
      password: credentials.password
    });
    
    if (error) {
      console.error('Supabase auth error:', error);
      return { 
        success: false, 
        message: error.message || 'Invalid credentials' 
      };
    }
    
    if (!data.session) {
      return { success: false, message: 'No session created' };
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error during login:', error);
    return { success: false, message: 'Network error. Please try again.' };
  }
}

export async function logoutAdmin(): Promise<{ success: boolean; message?: string }> {
  try {
    const { error } = await supabase.auth.signOut();
    
    if (error) {
      console.error('Error during logout:', error);
      return { success: false, message: error.message };
    }
    
    // Clear both localStorage and sessionStorage for better mobile support
    localStorage.removeItem('isAuthenticated');
    sessionStorage.removeItem('isAuthenticated');
    localStorage.removeItem('authExpiry');
    sessionStorage.removeItem('authExpiry');
    
    return { success: true };
  } catch (error) {
    console.error('Error during logout:', error);
    return { success: false, message: 'Network error. Please try again.' };
  }
}

export async function getSession() {
  return supabase.auth.getSession();
}

// Function to transform a Supabase record to a Reservation object
export function transformReservationRecord(record: any): Reservation | null {
  if (!record || typeof record !== 'object') {
    console.error('Invalid record received:', record);
    return null;
  }
  
  try {
    return {
      id: record.id,
      name: record.name,
      phone: record.phone,
      date: record.date,
      timeSlot: record.time_slot,
      status: record.status
    };
  } catch (error) {
    console.error('Error transforming reservation record:', error, record);
    return null;
  }
}
