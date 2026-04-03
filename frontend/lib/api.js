import axios from 'axios';

const api = axios.create({
baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Leaderboard
export const getGlobalLeaderboard = () => api.get('/portfolio/leaderboard');
export const toggleLeaderboardOptIn = (enabled) => api.patch('/portfolio/leaderboard-optin', { enabled });

// Friends
export const getMyInviteCode = () => api.get('/friends/code');
export const redeemFriendCode = (code) => api.post('/friends/redeem', { code });
export const getFriends = () => api.get('/friends');
export const removeFriend = (friendId) => api.delete(`/friends/${friendId}`);
export const getFriendsLeaderboard = () => api.get('/friends/leaderboard');

export default api;