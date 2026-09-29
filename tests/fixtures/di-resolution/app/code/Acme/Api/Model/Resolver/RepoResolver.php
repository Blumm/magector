<?php
declare(strict_types=1);

namespace Acme\Api\Model\Resolver;

class RepoResolver implements \Magento\Framework\GraphQl\Query\ResolverInterface
{
    public function __construct(private readonly \Acme\Core\Api\RepoInterface $repo)
    {
    }

    public function resolve($field, $context, $info, ?array $value = null, ?array $args = null)
    {
        return $this->repo->save((string)$args['id']);
    }
}
