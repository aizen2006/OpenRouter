import express from 'express';
import cors from "cors"
import { app as auth } from './routes/auth.routes';
import { app as apikeys } from './routes/apikeys.routes';
import { app as models } from './routes/models.routes';

const PORT = process.env.PORT ?? 3000;


const app = express();

app.use(cors());
app.use(express.json());

// routers
app.use('/auth',auth)
app.use('/apikeys',apikeys)
app.use('/models',models)



// Catch all Middleware
app.use((req, res) => {
    res.status(404).json({ 
        error: "Not Found", 
        path: req.originalUrl 
    });
});

app.listen(PORT ,()=>{
    console.log(`The server is running on PORT : ${PORT}`);
} );