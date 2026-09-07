import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import Layout from "@/components/Layout";
import Overview from "@/pages/Overview";
import Products from "@/pages/Products";
import ProductDetail from "@/pages/ProductDetail";
import Decisions from "@/pages/Decisions";
import Ads from "@/pages/Ads";
import Tasks from "@/pages/Tasks";
import Finance from "@/pages/Finance";
import Inventory from "@/pages/Inventory";

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/decisions" element={<Decisions />} />
          <Route path="/ads" element={<Ads />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/finance" element={<Finance />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="*" element={<Overview />} />
        </Routes>
      </Layout>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: "#10161E",
            border: "1px solid #33414F",
            color: "#E9EFF5",
          },
        }}
      />
    </BrowserRouter>
  );
}
