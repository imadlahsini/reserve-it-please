
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import ReservationTable from '../components/ReservationTable';
import { fetchReservations, updateReservation, Reservation, logoutAdmin, getSession } from '../utils/api';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check if user is authenticated
    const checkAuth = async () => {
      try {
        const { data, error } = await getSession();
        
        if (error || !data.session) {
          navigate('/admin');
          return;
        }
        
        // If authenticated, fetch reservations
        fetchData();
      } catch (err) {
        console.error('Auth check error:', err);
        navigate('/admin');
      }
    };
    
    checkAuth();
  }, [navigate]);

  const fetchData = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await fetchReservations();
      if (result.success) {
        setReservations(result.data || []);
      } else {
        setError(result.message || 'Failed to fetch reservations');
        toast.error(result.message || 'Failed to fetch reservations');
      }
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Network error. Please try again.');
      toast.error('Network error. Please try again.');
    } finally {
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
      const result = await logoutAdmin();
      if (result.success) {
        toast.success('Logged out successfully');
        navigate('/admin');
      } else {
        toast.error(result.message || 'Logout failed');
      }
    } catch (err) {
      console.error('Error during logout:', err);
      toast.error('Network error. Please try again.');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2">Loading reservations...</span>
      </div>
    );
  }

  if (error) {
    return <div className="flex justify-center items-center h-screen text-red-500">Error: {error}</div>;
  }

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
      
      <ReservationTable
        reservations={reservations}
        onStatusChange={handleStatusChange}
        onUpdate={handleUpdate}
      />
    </div>
  );
};

export default Dashboard;
