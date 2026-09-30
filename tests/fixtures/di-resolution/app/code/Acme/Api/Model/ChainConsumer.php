<?php
declare(strict_types=1);

namespace Acme\Api\Model;

class ChainConsumer
{
    public function __construct(private readonly \Acme\Core\Api\RepoInterface $repo)
    {
    }
}
