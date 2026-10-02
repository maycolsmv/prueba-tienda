import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import './styles.css';
import Layout from './components/Layout';
import { ConfirmProvider, ToastProvider } from './components/ui';
import Home from './pages/Home';
import NewSale from './pages/NewSale';
import Sales from './pages/Sales';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Reports from './pages/Reports';
import Settings from './pages/Settings';
import Trips from './pages/Trips';
import TripDetail from './pages/TripDetail';
import Expenses from './pages/Expenses';

registerSW({ immediate: true });

// Pide al navegador no borrar los datos locales cuando falte espacio.
navigator.storage?.persist?.().catch(() => {});

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/vender', element: <NewSale /> },
      { path: '/ventas', element: <Sales /> },
      { path: '/productos', element: <Products /> },
      { path: '/inventario', element: <Inventory /> },
      { path: '/clientes', element: <Customers /> },
      { path: '/clientes/:id', element: <CustomerDetail /> },
      { path: '/reportes', element: <Reports /> },
      { path: '/ajustes', element: <Settings /> },
      { path: '/viajes', element: <Trips /> },
      { path: '/viajes/:id', element: <TripDetail /> },
      { path: '/gastos', element: <Expenses /> },
      { path: '*', element: <Home /> },
    ],
  },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
);
