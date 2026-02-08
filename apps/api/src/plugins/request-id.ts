import { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';

const requestIdPluginCallback: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.addHook('onRequest', async (request, reply) => {
    // Ensure request ID is set
    if (!request.id) {
      request.id = crypto.randomUUID();
    }

    // Add to response headers
    reply.header('x-request-id', request.id);
  });

  fastify.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  done();
};

export const requestIdPlugin = fp(requestIdPluginCallback, {
  name: 'request-id',
});
