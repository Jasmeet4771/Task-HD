
import { BrowserRouter, Routes, Route } from "react-router-dom";

import Navbar from "./components/Navbar";
import Footer from "./components/Footer";

import Home from "./pages/Home";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Post from "./pages/Post";
import Pricing from "./pages/Pricing";
import BrowsePosts from "./pages/BrowsePosts";
import VerifyOTP from "./pages/VerifyOTP";
import SecuritySettings from "./pages/SecuritySettings";
import SessionManager from "./components/SessionManager";
import ReadingLists from "./pages/ReadingLists";


function App() {
  return (
    <BrowserRouter>
      <Navbar />
      <SessionManager />

      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/post" element={<Post />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/browse-posts" element={<BrowsePosts />} />
        <Route path="/verify-otp" element={<VerifyOTP />} />
        <Route path="/security-settings" element={<SecuritySettings />} />
        <Route path="/reading-lists" element={<ReadingLists />} />
      </Routes>

      <Footer />
    </BrowserRouter>
  );
}

export default App;
