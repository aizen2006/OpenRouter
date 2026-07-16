import express from "express";
import { app as chat } from "./routes/chat.routes";
import { auth } from "./middlewares/auth.middleware";
import { rateLimit } from "./middlewares/ratelimit.middleware";

const PORT = process.env.PORT ?? 3001;

const app = express();

//Auth and rateLimit
app.use(auth);
app.use(rateLimit);
app.use(express.json());

//routes
app.use('/chat',chat);

// Catch all Middleware
app.use((req, res) => {
    res.status(404).json({ 
        error: "Not Found", 
        path: req.originalUrl 
    });
});

app.listen(PORT,()=>{
    console.log(`the api-server is running on port ${PORT}`)
})