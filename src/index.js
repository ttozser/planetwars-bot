exports.handleRequest = (req, resp) => {
    var player = req.query.player;
    var gamestate = req.body;

    var ownedPlanets = gamestate.planets.filter(p => {
        return p.owner == player;
    });

    var from = Math.floor(Math.random() * ownedPlanets.length);
    var to = Math.floor(Math.random() * gamestate.planets.length);
    var numberOfShips = Math.floor(Math.random() * ownedPlanets[from].numberOfShips) + 1;

    var command = {
        'sourcePlanet': ownedPlanets[from].id,
        'destinationPlanet': gamestate.planets[to].id,
        'numberOfShips': numberOfShips
    };

    resp.status(200);
    resp.type('application/json');
    resp.send(command);
}